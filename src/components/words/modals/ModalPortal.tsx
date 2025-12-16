import React, { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface ModalPortalProps {
  children: ReactNode;
}

export default function ModalPortal({ children }: ModalPortalProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setContainer(document.body);
  }, []);

  if (typeof window === "undefined" || !container) {
    return null;
  }

  return createPortal(children, container);
}
