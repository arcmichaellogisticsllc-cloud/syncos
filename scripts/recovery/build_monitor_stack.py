#!/usr/bin/env python3
"""Render new monitoring/uploader resources; never manage the retained S3 bucket."""
import json
from pathlib import Path


def template():
    bucket = {'Ref': 'BackupBucket'}
    owner = {'Ref': 'AWS::AccountId'}
    objects = {'Fn::Sub': 'arn:${AWS::Partition}:s3:::${BackupBucket}/staging/*'}
    assume = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow', 'Principal': {'Service': 'lambda.amazonaws.com'}, 'Action': 'sts:AssumeRole'}]}
    def policy(statements):
        return {'Version': '2012-10-17', 'Statement': statements}
    def allow(actions, resource, **other):
        return dict(Effect='Allow', Action=actions, Resource=resource, **other)
    return {
      'AWSTemplateFormatVersion': '2010-09-09',
      'Description': 'SyncOS staging offsite writer and independent availability/freshness monitor',
      'Parameters': {'BackupBucket': {'Type': 'String'}, 'AlertEmail': {'Type': 'String'}},
      'Resources': {
        'Uploader': {'Type': 'AWS::IAM::User', 'Properties': {'Path': '/syncos/', 'Policies': [{
          'PolicyName': 'StagingCheckpointTransfer', 'PolicyDocument': policy([
            allow(['s3:PutObject','s3:GetObject','s3:GetObjectVersion'], objects)])}]}},
        'Alerts': {'Type': 'AWS::SNS::Topic', 'Properties': {'DisplayName': 'SyncOS staging recovery alerts'}},
        'Email': {'Type': 'AWS::SNS::Subscription', 'Properties': {'TopicArn': {'Ref':'Alerts'}, 'Protocol':'email', 'Endpoint': {'Ref':'AlertEmail'}}},
        'MonitorRole': {'Type': 'AWS::IAM::Role', 'Properties': {'AssumeRolePolicyDocument': assume, 'Policies': [{
          'PolicyName':'MonitorOnly', 'PolicyDocument':policy([
            allow(['s3:GetObject','s3:GetObjectVersion'], objects),
            allow(['cloudwatch:PutMetricData'],'*',Condition={'StringEquals':{'cloudwatch:namespace':'SyncOS/Recovery'}}),
            allow(['logs:CreateLogStream','logs:PutLogEvents'],{'Fn::Sub':'${MonitorLogGroup.Arn}'})])}]}},
        'MonitorLogGroup': {'Type':'AWS::Logs::LogGroup','Properties':{'LogGroupName':{'Fn::Sub':'/aws/lambda/${AWS::StackName}-monitor'},'RetentionInDays':14}},
        'Monitor': {'Type':'AWS::Lambda::Function','Properties':{
          'FunctionName':{'Fn::Sub':'${AWS::StackName}-monitor'},'Runtime':'python3.12','Handler':'index.handler',
          'Role':{'Fn::GetAtt':['MonitorRole','Arn']},'MemorySize':128,'Timeout':90,
          'Code':{'ZipFile':Path(__file__).with_name('external_monitor.py').read_text()},
          'Environment':{'Variables':{'BUCKET':bucket,'OWNER':owner,'STACK':{'Ref':'AWS::StackName'},
            'API_URL':'https://staging-api.synccommsystems.com/health/startup','WEB_URL':'https://staging-app.synccommsystems.com/login'}}}},
        'Schedule': {'Type':'AWS::Events::Rule','Properties':{'ScheduleExpression':'rate(5 minutes)','State':'ENABLED','Targets':[{'Arn':{'Fn::GetAtt':['Monitor','Arn']},'Id':'Monitor'}]}},
        'Invocation': {'Type':'AWS::Lambda::Permission','Properties':{'Action':'lambda:InvokeFunction','FunctionName':{'Ref':'Monitor'},'Principal':'events.amazonaws.com','SourceArn':{'Fn::GetAtt':['Schedule','Arn']}}},
        'Alarm': {'Type':'AWS::CloudWatch::Alarm','Properties':{
          'AlarmDescription':'Staging availability or offsite checkpoint freshness failed; missing monitor data also alarms.',
          'Namespace':'SyncOS/Recovery','MetricName':'Healthy','Dimensions':[{'Name':'Stack','Value':{'Ref':'AWS::StackName'}}],
          'Statistic':'Minimum','Period':300,'EvaluationPeriods':2,'DatapointsToAlarm':2,'Threshold':1,
          'ComparisonOperator':'LessThanThreshold','TreatMissingData':'breaching',
          'AlarmActions':[{'Ref':'Alerts'}],'OKActions':[{'Ref':'Alerts'}]}},
      },
      'Outputs': {'UploaderName':{'Value':{'Ref':'Uploader'}},'MonitorName':{'Value':{'Ref':'Monitor'}},
                  'AlertTopicArn':{'Value':{'Ref':'Alerts'}},'AlarmName':{'Value':{'Ref':'Alarm'}}}
    }

if __name__ == '__main__':
    print(json.dumps(template(),indent=2))
