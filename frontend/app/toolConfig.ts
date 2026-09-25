import {
  FileText,
  Bot,
  Cpu,
  Globe,
  Calculator,
  Search,
  Clock,
  BarChart3,
  TrendingUp,
  BookOpen,
} from "lucide-react";

export const TOOL_CONFIG: Record<string, { label: string; icon: typeof Bot; style: string }> = {
  rag_tool: { label: "Document Knowledge", icon: FileText, style: "text-amber-300 border-amber-500/30 bg-amber-500/10" },
  python_interpreter: { label: "Python Execution", icon: Cpu, style: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" },
  fetch_web_url: { label: "Web Page Fetch", icon: Globe, style: "text-sky-300 border-sky-500/30 bg-sky-500/10" },
  wikipedia_search: { label: "Wikipedia", icon: BookOpen, style: "text-indigo-300 border-indigo-500/30 bg-indigo-500/10" },
  duckduckgo_search: { label: "Web Search", icon: Search, style: "text-blue-300 border-blue-500/30 bg-blue-500/10" },
  search_tool: { label: "Web Search", icon: Search, style: "text-blue-300 border-blue-500/30 bg-blue-500/10" },
  get_current_datetime: { label: "Time Lookup", icon: Clock, style: "text-purple-300 border-purple-500/30 bg-purple-500/10" },
  analyze_tabular_data: { label: "Data Analysis", icon: BarChart3, style: "text-pink-300 border-pink-500/30 bg-pink-500/10" },
  get_stock_price: { label: "Stock Market", icon: TrendingUp, style: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10" },
  calculator: { label: "Math Calculation", icon: Calculator, style: "text-orange-300 border-orange-500/30 bg-orange-500/10" },
};
