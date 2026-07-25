const deliveryStage={SIGNING:4,READY:5,ATTEMPTING:6,SUBMITTED:6,CONFIRMED:7,RECOVERY_REQUIRED:6};

export function deliveryTimelineIndex(delivery){
  if(delivery?.state==="FAILED"){
    if(delivery.failureCode==="SIGNING_EXPIRED")return 4;
    return delivery.transactionHash?7:6;
  }
  return deliveryStage[delivery?.state];
}
