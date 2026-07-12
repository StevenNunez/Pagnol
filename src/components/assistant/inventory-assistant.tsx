'use client';

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Bot,
  Send,
  Loader2,
  X,
  User as UserIcon,
  RefreshCw,
  Cpu,
  Minimize2,
  Terminal
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/modules/auth/useAuth';
import { authHeaders } from '@/modules/core/lib/auth-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Message {
  role: 'user' | 'model';
  content: string;
}

const QUICK_QUERIES = [
  { label: "Stock Crítico", query: "¿Qué materiales están con stock crítico (bajo su mínimo)?" },
  { label: "Mantenciones Próximas", query: "¿Qué mantenimientos de activos están abiertos o programados para los próximos 7 días?" },
  { label: "Solicitudes Pendientes", query: "Dame un resumen de las solicitudes de material y de compra pendientes." },
  { label: "OT Abiertas", query: "¿Qué Órdenes de Trabajo están abiertas o en revisión?" },
];

export function InventoryAssistant() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const greeting = `Hola **${user?.name?.split(' ')[0] || 'Usuario'}**, soy Pagnol AI. Puedo consultar stock, kardex, solicitudes, OT, mantenimientos, asistencia, arriendos y pagos en tiempo real. ¿Qué necesitas saber?`;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [messages, isLoading, isOpen]);

  const handleSend = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const history = messages.slice(-12);
    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ question: text, history }),
      });
      const data = await res.json();

      if (res.ok && data.answer) {
        setMessages(prev => [...prev, { role: 'model', content: data.answer }]);
      } else {
        setMessages(prev => [...prev, { role: 'model', content: `❌ **Error:** ${data.error || 'No se recibió respuesta.'}` }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'model', content: '❌ **Error:** No se pudo contactar al asistente. Verifica tu conexión.' }]);
    }
    setIsLoading(false);
  };

  const clearChat = () => setMessages([]);

  return (
    <>
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant="default"
        className={cn(
          'fixed bottom-6 right-6 h-16 w-16 rounded-full shadow-2xl z-[100] flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95',
          isOpen ? 'bg-foreground text-background rotate-90' : 'bg-pagnol-orange text-white'
        )}
      >
        {isOpen ? <X size={28} /> : <Bot size={32} />}
      </Button>

      <div className={cn(
        'fixed bottom-28 right-8 w-[calc(100vw-4rem)] sm:w-[380px] h-[600px] max-h-[calc(100vh-8rem)] bg-card rounded-[2rem] shadow-2xl z-[100] flex flex-col overflow-hidden border border-border transition-all duration-300 origin-bottom-right',
        isOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0 pointer-events-none'
      )}>

        <header className="p-6 bg-pagnol-dark text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-pagnol-orange rounded-xl shadow-lg shadow-pagnol-orange/20">
              <Cpu size={18} />
            </div>
            <div>
              <h4 className="text-[11px] font-black uppercase tracking-widest leading-none">Pagnol AI</h4>
              <p className="text-[8px] text-pagnol-orange font-black uppercase tracking-widest mt-1">Asistente con Datos en Vivo</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={clearChat} className="p-2 text-white/40 hover:text-white h-auto w-auto">
              <RefreshCw size={14} />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="p-2 text-white/40 hover:text-white h-auto w-auto">
              <Minimize2 size={14} />
            </Button>
          </div>
        </header>

        <div className="px-4 py-3 bg-muted border-b border-border flex gap-2 overflow-x-auto no-scrollbar shrink-0">
          {QUICK_QUERIES.map((q, i) => (
            <Button
              key={i}
              variant="outline"
              size="sm"
              onClick={() => handleSend(q.query)}
              className="px-3 py-1.5 h-auto bg-card border-border rounded-full text-[8px] font-black text-muted-foreground uppercase tracking-widest hover:border-pagnol-orange hover:text-pagnol-orange transition-all whitespace-nowrap shadow-sm"
            >
              {q.label}
            </Button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="flex gap-3 items-start animate-in slide-in-from-bottom-2">
              <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center shadow-md bg-pagnol-dark text-pagnol-orange">
                <Bot size={16} />
              </div>
              <div className="p-4 rounded-[1.5rem] rounded-tl-none text-[11px] leading-relaxed shadow-sm border bg-card border-border text-muted-foreground">
                <div className="prose prose-xs max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-2 prose-li:my-0.5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{greeting}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 items-start ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-in slide-in-from-bottom-2`}>
              <div className={cn(
                'w-8 h-8 rounded-xl shrink-0 flex items-center justify-center shadow-md',
                msg.role === 'model' ? 'bg-pagnol-dark text-pagnol-orange' : 'bg-pagnol-orange text-white'
              )}>
                {msg.role === 'model' ? <Bot size={16} /> : <UserIcon size={16} />}
              </div>
              <div className={cn(
                'p-4 rounded-[1.5rem] text-[11px] leading-relaxed shadow-sm border',
                msg.role === 'model'
                  ? 'bg-card border-border text-muted-foreground rounded-tl-none'
                  : 'bg-pagnol-orange text-white border-pagnol-orange rounded-tr-none'
              )}>
                <div className="prose prose-xs max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-2 prose-li:my-0.5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-3 animate-pulse">
              <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center text-muted-foreground">
                <Bot size={16} />
              </div>
              <div className="bg-card border border-border p-4 rounded-[1.5rem] rounded-tl-none">
                <div className="flex gap-1 items-center">
                  <div className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-border bg-card shrink-0">
          <form
            onSubmit={(e) => { e.preventDefault(); handleSend(input); }}
            className="relative flex items-center gap-3"
          >
            <div className="relative flex-1">
              <Terminal className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
              <Input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="CONSULTAR AI..."
                className="w-full pl-10 pr-4 py-3 h-auto bg-muted border-border rounded-2xl outline-none font-black text-[9px] tracking-widest focus:bg-card focus:border-pagnol-orange transition-all"
                disabled={isLoading}
              />
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || isLoading}
              className="h-12 w-12 shrink-0 bg-pagnol-orange text-white rounded-xl shadow-xl shadow-pagnol-orange/20 hover:bg-orange-600 disabled:opacity-30 transition-all"
            >
              {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}
