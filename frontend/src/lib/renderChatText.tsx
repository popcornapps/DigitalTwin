import React from 'react';

// Renders the small, fixed markdown subset the AI Copilot's system prompt
// (backend/app/copilot/llm_agent.py) is instructed to use - **bold** spans
// and "- " bullet lists - so its formatting instructions actually show up
// visually instead of leaking literal "**"/"-" characters. Deliberately not
// a full markdown parser/library: kept to exactly what the prompt asks the
// model to produce, nothing more.

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>;
  });
}

// Groups a bullet block's lines into items - a line starting a NEW item
// (matches the bullet marker) vs a continuation line (a wrapped second line
// of the same item, e.g. "- Title\n  more detail") that gets folded into the
// previous item rather than breaking the list.
function groupListItems(lines: string[]): string[] {
  const items: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[-*]\s+/.test(trimmed)) {
      items.push(trimmed.replace(/^[-*]\s+/, ''));
    } else if (items.length > 0) {
      items[items.length - 1] += ' ' + trimmed;
    } else {
      items.push(trimmed);
    }
  }
  return items;
}

export function renderChatText(text: string): React.ReactNode {
  const blocks = text.split(/\n\s*\n/);
  return blocks.map((block, blockIdx) => {
    const lines = block.split('\n').filter(l => l.trim() !== '');
    // A block is a bullet list if it STARTS with a bullet marker - later
    // lines may be a wrapped continuation of that same item (see
    // groupListItems), not necessarily bullets of their own.
    const isList = lines.length > 0 && /^[-*]\s+/.test(lines[0].trim());

    if (isList) {
      const items = groupListItems(lines);
      return (
        <ul key={blockIdx} className={`list-disc pl-5 space-y-1 ${blockIdx > 0 ? 'mt-2' : ''}`}>
          {items.map((item, i) => (
            <li key={i}>{renderInline(item, `${blockIdx}-${i}`)}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={blockIdx} className={blockIdx > 0 ? 'mt-2' : undefined}>
        {lines.map((line, i) => (
          <React.Fragment key={i}>
            {i > 0 && <br />}
            {renderInline(line, `${blockIdx}-${i}`)}
          </React.Fragment>
        ))}
      </p>
    );
  });
}
