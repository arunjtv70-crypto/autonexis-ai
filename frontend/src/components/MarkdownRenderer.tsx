import React, { useState } from "react";
import { marked } from "marked";
import katex from "katex";
import "katex/dist/katex.min.css";
import { IconCopy, IconCheck } from "./Icons";
import "./MarkdownRenderer.css";

interface MarkdownRendererProps {
  content: string;
}

// ---------------------------------------------------------------------------
// Math Preprocessing & Postprocessing Helpers
// ---------------------------------------------------------------------------

function preprocessMath(raw: string): { processed: string; currencyMap: string[] } {
  if (!raw) return { processed: "", currencyMap: [] };

  // 1. Protect escaped dollars: \$ -> temporary token
  let text = raw.replace(/\\\$/g, "@@ESCAPED_DOLLAR@@");

  // 2. Protect real-world currency ($5, $10.50, $1,000, etc.) from being parsed as math
  const currencyMap: string[] = [];
  text = text.replace(/(^|[\s(])\$(\d+(?:,\d{3})*(?:\.\d+)?)(?=$|[\s),.?!;:])/g, (_match, prefix, amount) => {
    const idx = currencyMap.length;
    currencyMap.push(`$${amount}`);
    return `${prefix}@@CURRENCY_${idx}@@`;
  });

  // 3. Convert LaTeX delimiters \[ ... \] to $$ ... $$ and \( ... \) to $ ... $
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_match, eq) => `\n\n$$${eq.trim()}$$\n\n`);
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_match, eq) => `$${eq.trim()}$`);

  // 4. Streaming safeguard: If the content ends with an unclosed $$ (odd number of $$)
  // temporarily strip the unclosed trailing block so incomplete raw LaTeX doesn't flash
  const doubleDollarCount = (text.match(/\$\$/g) || []).length;
  if (doubleDollarCount % 2 !== 0) {
    const lastIdx = text.lastIndexOf("$$");
    text = text.slice(0, lastIdx);
  }

  return { processed: text, currencyMap };
}

function restorePlaceholders(html: string, currencyMap: string[]): string {
  if (!html) return "";
  let out = html;
  currencyMap.forEach((curr, idx) => {
    out = out.replace(new RegExp(`@@CURRENCY_${idx}@@`, "g"), curr);
  });
  out = out.replace(/@@ESCAPED_DOLLAR@@/g, "$");
  return out;
}

// ---------------------------------------------------------------------------
// Marked Extensions for KaTeX
// ---------------------------------------------------------------------------

const blockMathExtension = {
  name: "blockMath",
  level: "block" as const,
  start(src: string) {
    return src.indexOf("$$");
  },
  tokenizer(src: string) {
    const match = src.match(/^\$\$([\s\S]+?)\$\$/);
    if (match) {
      return {
        type: "blockMath",
        raw: match[0],
        text: match[1].trim(),
      };
    }
  },
};

const inlineMathExtension = {
  name: "inlineMath",
  level: "inline" as const,
  start(src: string) {
    return src.indexOf("$");
  },
  tokenizer(src: string) {
    // Only match $...$ if opening has non-space right after and closing has non-space right before
    const match = src.match(/^\$([^\s\$](?:[\s\S]*?[^\s\$])?)\$/);
    if (match) {
      return {
        type: "inlineMath",
        raw: match[0],
        text: match[1],
      };
    }
  },
  renderer(token: { text: string }) {
    try {
      return katex.renderToString(token.text, {
        displayMode: false,
        throwOnError: false,
      });
    } catch {
      return `<code class="math-fallback">${token.text}</code>`;
    }
  },
};

// Register extensions with marked
marked.use({
  extensions: [blockMathExtension, inlineMathExtension],
});

// ---------------------------------------------------------------------------
// Block Math Equation Component with Copy LaTeX Action
// ---------------------------------------------------------------------------

const BlockMathEquation: React.FC<{ latex: string }> = ({ latex }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(latex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  let renderedHtml = "";
  let hasError = false;
  try {
    renderedHtml = katex.renderToString(latex, {
      displayMode: true,
      throwOnError: false,
    });
  } catch {
    hasError = true;
  }

  return (
    <div className="math-block-container">
      <div className="math-block-header">
        <span className="math-block-tag">math</span>
        <button
          type="button"
          className="math-copy-btn"
          onClick={handleCopy}
          title="Copy LaTeX formula"
          aria-label="Copy LaTeX formula"
        >
          {copied ? (
            <>
              <IconCheck size={12} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <IconCopy size={12} />
              <span>Copy LaTeX</span>
            </>
          )}
        </button>
      </div>
      <div className="math-block-content">
        {hasError ? (
          <code className="math-fallback">{latex}</code>
        ) : (
          <div
            className="katex-scroll-container"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Code Block Component with Copy Action
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main MarkdownRenderer Component
// ---------------------------------------------------------------------------

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  if (!content) return null;

  try {
    const { processed, currencyMap } = preprocessMath(content);
    const tokens = marked.lexer(processed);

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

          if (token.type === "blockMath") {
            const mathToken = token as unknown as { text: string };
            return (
              <BlockMathEquation
                key={`math-${index}`}
                latex={mathToken.text || ""}
              />
            );
          }

          // Parse other tokens (paragraphs, lists, headings, tables, blockquotes)
          const rawHtml = marked.parser([token]);
          const finalHtml = restorePlaceholders(rawHtml, currencyMap);

          return (
            <div
              key={`block-${index}`}
              className="markdown-block"
              dangerouslySetInnerHTML={{ __html: finalHtml }}
            />
          );
        })}
      </div>
    );
  } catch {
    return <div className="markdown-body plain-fallback">{content}</div>;
  }
};
