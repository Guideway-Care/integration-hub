import { useState } from "react";
import { ChevronDown, ChevronRight, Code } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RawDataViewerProps {
  data: any;
  title?: string;
}

export function RawDataViewer({ data, title = "Raw Payload" }: RawDataViewerProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border border-border/50 rounded-md overflow-hidden bg-black/40">
      <div 
        className="flex items-center justify-between p-3 bg-black/60 cursor-pointer hover:bg-black/80 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Code className="w-4 h-4" />
          {title}
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
      </div>
      {isExpanded && (
        <div className="p-4 overflow-auto max-h-96 text-xs font-mono text-emerald-400/90 leading-relaxed">
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export function GenericTable({ data }: { data: any }) {
  if (!data) return <div className="p-4 text-center text-sm text-muted-foreground">No data available</div>;
  
  // If it's an array of objects, we can render a table
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
    const keys = Object.keys(data[0]).slice(0, 8); // Limit columns
    
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-black/20">
            <tr>
              {keys.map((key) => (
                <th key={key} className="px-4 py-3 font-medium">{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-white/5 transition-colors">
                {keys.map((key) => (
                  <td key={key} className="px-4 py-3 font-mono">
                    {typeof row[key] === 'object' ? JSON.stringify(row[key]) : String(row[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Fallback to raw viewer
  return <RawDataViewer data={data} title="Data Preview" />;
}
