import type { TriageSnippet } from "../source/types.ts";

/** 本文の抜粋。言及した語に印を付ける */
export function Snippet({
  snippet,
  className = "triage-snippet",
}: {
  snippet: TriageSnippet;
  className?: string;
}) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  snippet.marks.forEach(([s, e], i) => {
    if (s > at) parts.push(snippet.text.slice(at, s));
    parts.push(<mark key={i}>{snippet.text.slice(s, e)}</mark>);
    at = e;
  });
  if (at < snippet.text.length) parts.push(snippet.text.slice(at));
  return <p className={className}>{parts}</p>;
}
