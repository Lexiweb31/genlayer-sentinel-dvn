const publicIdentifierPattern=/^[A-Za-z0-9](?:[A-Za-z0-9 ._:-]{0,126}[A-Za-z0-9])?$/;

export function isPathwayAuditPublicIdentifier(value:unknown):value is string{
  return typeof value==="string"&&publicIdentifierPattern.test(value);
}
