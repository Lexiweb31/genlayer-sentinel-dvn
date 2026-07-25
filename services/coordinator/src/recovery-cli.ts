import{runRecoveryCommand}from"./recovery-command.js";

void runRecoveryCommand(process.argv.slice(2),{
  stdout:value=>process.stdout.write(value),
  stderr:value=>process.stderr.write(value)
}).then(code=>{process.exitCode=code}).catch(()=>{process.stderr.write('{"error":"RECOVERY_CLI_FAILED"}\n');process.exitCode=1});
