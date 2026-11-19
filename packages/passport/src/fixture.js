'use strict';
exports.fixture = () => ({
 binding:{mode:'simulation',tenantId:'synthetic-sync',customerId:'synthetic-customer',accountId:'synthetic-account'},
 transaction:{customerId:'synthetic-customer',accountId:'synthetic-account',transactionId:'synthetic-payment',payeeId:'synthetic-partner',direction:'outgoing',currency:'USD',amount:'70.00',status:'completed',version:1,completedDate:'2026-09-01'},
 seed:{mappings:[{tenantId:'synthetic-sync',customerId:'synthetic-customer',accountId:'synthetic-account',transactionId:'synthetic-payment',payeeId:'synthetic-partner',payableId:'synthetic-payable',amount:'70.00',currency:'USD'}],payables:{'synthetic-payable':{tenantId:'synthetic-sync',payeeId:'synthetic-partner',workforce:'partner',currency:'USD',accepted:true,approved:true,cashClearedAndAllocated:true,eligibleAmount:'70.00',paidAmount:'0.00',inFlightAmount:'0.00'}}}
});
