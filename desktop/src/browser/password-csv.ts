export type PasswordRow = { name: string; url: string; username: string; password: string };

/** Chrome and Edge's explicit CSV export uses RFC 4180 quoting, including multiline fields. */
export function passwordCsv(text: string): PasswordRow[] {
  const records: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    afterQuote = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
        afterQuote = true;
      }
    } else if (ch === ",") {
      row.push(field);
      field = "";
      afterQuote = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some(Boolean)) records.push(row);
      row = [];
      field = "";
      afterQuote = false;
    } else if (ch === '"' && !field && !afterQuote) quoted = true;
    else if (ch === '"' || afterQuote) throw new Error("Invalid password CSV");
    else field += ch;
  }
  if (quoted) throw new Error("Invalid password CSV");
  row.push(field);
  if (row.some(Boolean)) records.push(row);
  const headers = records.shift()?.map((value) => value.trim().toLowerCase()) ?? [];
  const url = headers.indexOf("url"),
    username = headers.indexOf("username"),
    password = headers.indexOf("password"),
    name = headers.indexOf("name");
  if ([url, username, password].includes(-1) || records.length > 10000)
    throw new Error("Unsupported password CSV");
  return records.map((cells) => ({
    url: cells[url] ?? "",
    username: cells[username] ?? "",
    password: cells[password] ?? "",
    name: cells[name] || cells[url] || "",
  }));
}
