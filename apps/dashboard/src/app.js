const stages=["Packet detected","RPC confirmations","GenLayer consensus","GenLayer finality","Signer quorum","LayerZero verification","OApp execution"];
document.querySelector("#timeline").innerHTML=stages.map((s,i)=>`<div class="step"><span>${String(i+1).padStart(2,"0")}</span><div><strong>${s}</strong><small>Not started</small></div></div>`).join("");
