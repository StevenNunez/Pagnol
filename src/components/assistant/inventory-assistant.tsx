'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { askPagnol } from '@/actions/ask-ferro';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const QUICK_QUERIES = [
  { label: "Equipos Críticos", query: "Revisa el estado de las herramientas y dime si alguna crítica está en mantenimiento o con bajo stock." },
  { label: "Alertas de Stock", query: "Analiza el inventario y dime si hay materiales con stock crítico (menos de 10 unidades)." },
  { label: "Resumen de Compras", query: "Dame un resumen de las solicitudes de compra pendientes de aprobación." },
  { label: "Próximo Mantenimiento", query: "Busca en el inventario si hay algún equipo con mantenimiento programado para los próximos 7 días." }
];

export function InventoryAssistant() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: `Hola **${user?.name?.split(' ')[0] || 'Usuario'}**, soy PAGNOL AI. ¿Necesitas datos de stock o riesgos en faena?`
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { materials, tools, users, purchaseRequests, requests, workItems } = useAppState();

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [messages, isLoading, isOpen]);

  const fullContextString = useMemo(() => {
    const contextData = {
      inventory: {
        materials: materials?.slice(0, 50).map(m => ({
          name: m.name,
          stock: m.stock,
          unit: m.unit,
          category: m.category,
          status: m.stock <= 10 ? 'CRITICAL_LOW' : 'OK'
        })),
        tools: tools?.slice(0, 30).map((t: any) => ({
          name: t.name,
          status: t.status,
          category: t.category
        })),
        summary: {
          totalMaterials: materials?.length || 0,
          totalTools: tools?.length || 0,
          criticalLowItems: materials?.filter(m => m.stock <= 10).length || 0
        }
      },
      requests: {
        materialRequests: requests?.slice(0, 20).map((r: any) => ({
          status: r.status,
          supervisor: users?.find(u => u.id === r.supervisorId)?.name || 'Desconocido',
          area: r.area,
          items: r.items?.length || 1,
        })),
        purchaseRequests: purchaseRequests?.slice(0, 20).map((pr: any) => ({
          status: pr.status,
          material: pr.materialName,
          quantity: pr.quantity,
        }))
      },
      project: {
        workItems: workItems?.slice(0, 20).map((wi: any) => ({
          name: wi.name,
          type: wi.type,
          progress: wi.progress,
          status: wi.status,
        })),
      },
      users: users?.slice(0, 20).map(u => ({
        name: u.name,
        role: u.role,
      })),
      currentDate: new Date().toLocaleDateString('es-CL')
    };
    return JSON.stringify(contextData);
  }, [materials, tools, requests, purchaseRequests, workItems, users]);

  const handleSend = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const res = await askPagnol(text, fullContextString);

    if (res?.ok && res.answer) {
      setMessages(prev => [...prev, { role: 'assistant', content: res.answer! }]);
    } else {
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ **Error:** ${res?.error || 'No se recibió respuesta.'}` }]);
    }
    setIsLoading(false);
  };

  const clearChat = () => {
    setMessages([
      {
        role: 'assistant',
        content: `Chat reiniciado. Hola de nuevo, **${user?.name?.split(' ')[0] || 'Usuario'}**. ¿En qué puedo ayudarte?`
      }
    ]);
  };

  return (
    <>
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant="default"
        className={cn(
          'fixed bottom-6 right-6 h-16 w-16 rounded-full shadow-2xl z-[100] flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95',
          isOpen ? 'bg-slate-800 text-white rotate-90' : 'bg-pagnol-orange text-white'
        )}
      >
        {isOpen ? <X size={28} /> : <Bot size={32} />}
      </Button>

      <div className={cn(
        'fixed bottom-28 right-8 w-[calc(100vw-4rem)] sm:w-[380px] h-[600px] max-h-[calc(100vh-8rem)] bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl z-[100] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800 transition-all duration-300 origin-bottom-right',
        isOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0 pointer-events-none'
      )}>

        <header className="p-6 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-pagnol-orange rounded-xl shadow-lg shadow-pagnol-orange/20">
              <Cpu size={18} />
            </div>
            <div>
              <h4 className="text-[11px] font-black uppercase tracking-widest leading-none">Pagnol AI</h4>
              <p className="text-[8px] text-pagnol-orange font-black uppercase tracking-widest mt-1">Intelligence Assistant</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={clearChat} className="p-2 text-white/20 hover:text-white h-auto w-auto">
              <RefreshCw size={14} />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="p-2 text-white/20 hover:text-white h-auto w-auto">
              <Minimize2 size={14} />
            </Button>
          </div>
        </header>

        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 flex gap-2 overflow-x-auto no-scrollbar shrink-0">
          {QUICK_QUERIES.map((q, i) => (
            <Button
              key={i}
              variant="outline"
              size="sm"
              onClick={() => handleSend(q.query)}
              className="px-3 py-1.5 h-auto bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 rounded-full text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest hover:border-pagnol-orange hover:text-pagnol-orange transition-all whitespace-nowrap shadow-sm"
            >
              {q.label}
            </Button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/20 dark:bg-slate-950/20" ref={scrollRef}>
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 items-start ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-in slide-in-from-bottom-2`}>
              <div className={cn(
                'w-8 h-8 rounded-xl shrink-0 flex items-center justify-center shadow-md',
                msg.role === 'assistant' ? 'bg-pagnol-dark text-pagnol-orange' : 'bg-pagnol-orange text-white'
              )}>
                {msg.role === 'assistant' ? <Bot size={16} /> : <UserIcon size={16} />}
              </div>
              <div className={cn(
                'p-4 rounded-[1.5rem] text-[11px] leading-relaxed shadow-sm border',
                msg.role === 'assistant'
                  ? 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-tl-none'
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
              <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-300 dark:text-slate-600">
                <Bot size={16} />
              </div>
              <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 p-4 rounded-[1.5rem] rounded-tl-none">
                <div className="flex gap-1 items-center">
                  <div className="w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <form
            onSubmit={(e) => { e.preventDefault(); handleSend(input); }}
            className="relative flex items-center gap-3"
          >
            <div className="relative flex-1">
              <Terminal className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 dark:text-slate-600" size={14} />
              <Input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="CONSULTAR AI..."
                className="w-full pl-10 pr-4 py-3 h-auto bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 rounded-2xl outline-none font-black text-[9px] tracking-widest focus:bg-white dark:focus:bg-slate-900 focus:border-pagnol-orange transition-all"
                disabled={isLoading}
              />
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || isLoading}
              className="h-12 w-12 shrink-0 bg-pagnol-orange text-white rounded-xl shadow-xl shadow-pagnol-orange/20 hover:bg-orange-600 disabled:opacity-30 transition-all"
            >
              <Send size={18} />
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}
