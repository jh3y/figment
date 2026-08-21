import type { ReactNode } from "react";

export function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (!list.length) return;
    blocks.push(<ul key={`list-${blocks.length}`}>{list.map((item) => <li key={item}>{item}</li>)}</ul>);
    list = [];
  };
  lines.forEach((line, index) => {
    if (line.startsWith("- ")) { list.push(line.slice(2)); return; }
    flushList();
    if (line.startsWith("# ")) blocks.push(<h1 key={index}>{line.slice(2)}</h1>);
    else if (line.startsWith("## ")) blocks.push(<h2 key={index}>{line.slice(3)}</h2>);
    else if (line.startsWith("### ")) blocks.push(<h3 key={index}>{line.slice(4)}</h3>);
    else if (line.startsWith("> ")) blocks.push(<blockquote key={index}>{line.slice(2)}</blockquote>);
    else if (line.trim()) blocks.push(<p key={index}>{line}</p>);
  });
  flushList();
  return <div className="markdown">{blocks}</div>;
}
