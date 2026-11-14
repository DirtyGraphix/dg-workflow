// The Worker imports design/tokens.css as plain text (see "rules" in wrangler.jsonc).
declare module "*.css" {
  const text: string;
  export default text;
}
