import{runPathwayAuditCommand}from"./pathway-audit-command.js";

const code=await runPathwayAuditCommand(
  process.argv.slice(2),
  {stdout:value=>process.stdout.write(value),stderr:value=>process.stderr.write(value)}
);
process.exitCode=code;
