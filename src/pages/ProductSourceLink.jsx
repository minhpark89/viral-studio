import { useState } from "react";
import { ExternalLink } from "lucide-react";

export function ProductSourceLink({ href, children }) {
  const [error, setError] = useState("");
  const open = async (event) => {
    if (!window.studioDesktop?.openExternal) return;
    event.preventDefault();
    try {
      await window.studioDesktop.openExternal(href);
      setError("");
    } catch (e) {
      setError(
        `Không mở được trình duyệt: ${e.message}. Có thể sao chép link bên dưới.`,
      );
    }
  };
  return (
    <span className="product-source-link">
      <a href={href} target="_blank" rel="noreferrer" onClick={open}>
        {children} <ExternalLink size={12} />
      </a>
      {error && (
        <span className="small danger-text" role="alert">
          {error}
          <code>{href}</code>
        </span>
      )}
    </span>
  );
}
