type TableProps = {
  columns: string[];
  rows: Array<Array<string | number>>;
};

export function Table({ columns, rows }: TableProps) {
  if (!rows.length) {
    return <div className="rounded border border-dashed border-line p-5 text-sm text-muted">No data available</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="text-muted">
          <tr>
            {columns.map((column) => (
              <th className="border-b border-line pb-2 font-semibold" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr className="border-b border-line last:border-0" key={`${row.join("-")}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td className="py-3 pr-4 text-ink" key={`${cell}-${cellIndex}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
