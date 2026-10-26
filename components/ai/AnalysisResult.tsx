"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  markdown: string;
  streaming?: boolean;
}

export function AnalysisResult({ markdown, streaming }: Props) {
  return (
    <Card className="shiny-border">
      <CardContent className="p-6">
        <div className="prose prose-sm prose-invert max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-p:text-foreground/90 prose-strong:text-foreground prose-code:font-mono prose-code:text-xs prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted/60 prose-pre:border prose-pre:border-border prose-table:text-xs prose-th:text-foreground prose-th:font-semibold prose-a:text-primary prose-li:text-foreground/90 prose-ul:my-2 prose-ol:my-2 prose-blockquote:border-l-primary/60">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
          {streaming && (
            <span
              className={cn(
                "inline-block h-4 w-[2px] -mb-[2px] ml-0.5 align-middle bg-primary animate-pulse",
              )}
              aria-hidden
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
