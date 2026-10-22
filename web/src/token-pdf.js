// Ten cut-out tickets per A4 page, with token codes kept as selectable text.
export async function createTokensPdf(tokens) {
  tokens = tokens.filter((token) => !token.used);
  if (!tokens.length) throw new Error("No unused tokens to export. Generate tokens or adjust the filters.");

  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ format: "a4", unit: "mm", compress: true });
  pdf.setProperties({ title: "ANHS Student Voting Tokens", author: "ANHS Voting System" });

  const perPage = 10;
  const pages = Math.ceil(tokens.length / perPage);
  const width = 91;
  const height = 46;

  for (let page = 0; page < pages; page++) {
    if (page) pdf.addPage();
    pdf.setTextColor(23, 36, 58);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("ANHS Student Voting Tokens", 12, 15);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(`${tokens.length} token(s) | Page ${page + 1} of ${pages}`, 12, 21);

    tokens.slice(page * perPage, (page + 1) * perPage).forEach((token, index) => {
      const x = 12 + (index % 2) * (width + 4);
      const y = 28 + Math.floor(index / 2) * (height + 4);
      const name = token.last_name
        ? `${token.last_name}, ${[token.first_name, token.given_name].filter(Boolean).join(" ")}`
        : "Unassigned student";

      pdf.setDrawColor(140, 150, 165);
      pdf.setLineWidth(0.2);
      pdf.rect(x, y, width, height);
      pdf.setTextColor(80, 95, 115);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.text("ANHS VOTING SYSTEM", x + 4, y + 5);
      pdf.text("Unused", x + width - 4, y + 5, { align: "right" });

      // Fit long student names within two lines without cutting off the name.
      pdf.setTextColor(23, 36, 58);
      pdf.setFont("helvetica", "bold");
      let nameSize = 10;
      pdf.setFontSize(nameSize);
      while (pdf.splitTextToSize(name, width - 8).length > 2 && nameSize > 5) {
        pdf.setFontSize(--nameSize);
      }
      pdf.text(pdf.splitTextToSize(name, width - 8), x + 4, y + 11);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.text([token.grade, token.section].filter(Boolean).join(" | "), x + 4, y + 20, { maxWidth: width - 8 });
      pdf.setFont("courier", "bold");
      pdf.setFontSize(20);
      pdf.text(token.code, x + width / 2, y + 31, { align: "center" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.setTextColor(80, 95, 115);
      pdf.text("Single use only. Do not share with others.", x + width / 2, y + 41, { align: "center" });
    });
  }

  return pdf;
}
