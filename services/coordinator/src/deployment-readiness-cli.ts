import{runDeploymentReadinessCommand}from"./deployment-readiness-command.js";
const code=await runDeploymentReadinessCommand(
  process.argv.slice(2),
  {stdout:value=>process.stdout.write(value),stderr:value=>process.stderr.write(value)}
);
process.exitCode=code;
