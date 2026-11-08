import React, { useState } from "react";
import { marked } from "marked";
import { IconCopy, IconCheck } from "./Icons";
import "./MarkdownRenderer.css";

interface MarkdownRendererProps {
  content: string;
}

const CodeBlock: React.FC<{ code: string; lang?: string }> = ({ code, lang }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const cleanLang = (lang || "").trim().toLowerCase();

  return (
    <div className="code-block-container">
      <div className="code-block-header">
        <span className="code-block-lang">{cleanLang || "code"}</span>
        <button
          type="button"
          className="code-copy-btn"
          onClick={handleCopy}
          title="Copy code to clipboard"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <IconCheck size={12} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <IconCopy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="code-block-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  if (!content) return null;

  try {
    const tokens = marked.lexer(content);

    return (
      <div className="markdown-body">
        {tokens.map((token, index) => {
          if (token.type === "code") {
            return (
              <CodeBlock
                key={`code-${index}`}
                code={token.text}
                lang={token.lang}
              />
            );
          }

          // Parse non-code tokens (paragraphs, lists, headings, tables, blockquotes)
          const rawHtml = marked.parser([token]);
          return (
            <div
              key={`block-${index}`}
              className="markdown-block"
              dangerouslySetInnerHTML={{ __html: rawHtml }}
            />
          );
        })}
      </div>
    );
  } catch {
    return <div className="markdown-body plain-fallback">{content}</div>;
  }
};
