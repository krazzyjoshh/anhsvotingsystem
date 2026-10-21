import { useRef, useState } from "react";
import { Icon } from "../admin";
import { createTokensPdf } from "../token-pdf";

export default function TokensPdfButton({ getTokens, disabled = false, onError }) {
  const [downloading, setDownloading] = useState(false);
  const pending = useRef(false);

  async function download() {
    if (pending.current) return;
    pending.current = true;
    setDownloading(true);
    try {
      const pdf = await createTokensPdf(await getTokens());
      await pdf.save("anhs-student-tokens.pdf", { returnPromise: true });
    } catch (error) {
      onError(error.message || "Unable to generate the PDF. Please try again.");
    } finally {
      pending.current = false;
      setDownloading(false);
    }
  }

  return <button className="admin-button" disabled={disabled || downloading} onClick={download} aria-busy={downloading}>
    <Icon name="download" size={16} />{downloading ? "Generating PDF..." : "Download PDF"}
  </button>;
}
