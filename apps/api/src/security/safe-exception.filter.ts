import {ArgumentsHost,Catch,HttpException,type ExceptionFilter} from '@nestjs/common';
import type {Response} from 'express';
import {logStructured} from '../instrumentation/structured-logger';
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
 catch(exception:unknown,host:ArgumentsHost){
  const response=host.switchToHttp().getResponse<Response>();
  const code=exception&&typeof exception==='object'&&'code' in exception?String(exception.code):'';
  const status=exception instanceof HttpException?exception.getStatus():['23505','23503','23514','P0001','22P02'].includes(code)?400:500;
  let message:unknown='The request could not be completed. Refresh and try again.';
  if(exception instanceof HttpException){const body=exception.getResponse();message=typeof body==='string'?body:(body as {message?:unknown}).message??message;}
  if(code&&status===400)message='The change conflicts with the current record. Refresh and review its source and approval status.';
  if(/invalid input syntax|violates .*constraint|syntax error at|relation ".*"|column ".*"|Bearer /i.test(JSON.stringify(message))) {
   // Preserve the intentionally generic authentication response.
   message=status===401?'Invalid email or password':'The request contains an invalid value or conflicts with the current record.';
  }
  if(status>=500)logStructured('API','request_failed',{code:code||'unexpected_error'});
  response.status(status).json({statusCode:status,message});
 }
}
