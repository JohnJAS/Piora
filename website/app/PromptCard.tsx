'use client';

import { useState } from 'react';

export default function PromptCard({ label, prompt }: { label: string; prompt: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="recipe-card">
      <button type="button" className="recipe-copy" onClick={copy}>{copied ? '已复制 ✓' : '复制'}</button>
      <b>{label}</b>
      <p>{prompt}</p>
    </div>
  );
}
