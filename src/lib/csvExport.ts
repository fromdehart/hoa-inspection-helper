export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function rowsToCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const headerLine = headers.map((header) => escapeCsvCell(header)).join(",");
  const dataLines = rows.map((row) =>
    headers.map((header) => escapeCsvCell(row[header] as string | number | boolean | null | undefined)).join(","),
  );
  return [headerLine, ...dataLines].join("\n");
}

export function downloadCsv(filename: string, csvText: string): void {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
