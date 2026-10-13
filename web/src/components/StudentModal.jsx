import { useEffect, useRef } from "react";

export default function StudentModal({ id, label, open, busy = false, onClose, children, wide = false }) {
  const dialog = useRef(null);

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    element.querySelector("input:not(:disabled), button:not(:disabled)")?.focus();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function cancel(event) {
    event.preventDefault();
    if (!busy) onClose();
  }

  function clickBackdrop(event) {
    if (busy || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }

  return <dialog ref={dialog} id={id} className={`student-modal${wide ? " student-modal-wide" : ""}`} aria-label={label} aria-modal="true" onCancel={cancel} onClick={clickBackdrop}>
    {children}
  </dialog>;
}
