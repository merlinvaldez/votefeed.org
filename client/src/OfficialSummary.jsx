import { useLayoutEffect, useRef } from "react";

export default function OfficialSummary({ html }) {
  const container = useRef(null);
  useLayoutEffect(() => {
    for (const link of container.current?.querySelectorAll("a[href]") ?? []) {
      link.target = "_blank";
      link.relList.add("noopener");
    }
  });
  return <div ref={container} className="leg-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
