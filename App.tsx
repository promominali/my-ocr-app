
import React, { useState, useRef, useEffect } from 'react';
import { DocumentState, OCRPage, ChatMessage } from './types';
import { performOCR, chatWithDocument } from './services/geminiService';
import { downloadAsText, downloadAsWord, downloadAsSimplePDF, downloadAsHTML } from './services/exportService';

// PDF.js worker setup
// @ts-ignore
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const App: React.FC = () => {
  const [docState, setDocState] = useState<DocumentState>({
    fileName: '',
    pages: [],
    fullText: '',
    status: 'idle',
    progress: 0,
  });

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [apiError, setApiError] = useState<string | null>(null);
  
  const timerRef = useRef<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const isTerminatedRef = useRef<boolean>(false);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (chatMessages.length > 0) scrollToBottom();
  }, [chatMessages]);

  useEffect(() => {
    if (docState.status === 'processing') {
      const start = Date.now();
      timerRef.current = window.setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - start) / 100) / 10);
      }, 100);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [docState.status]);

  const stopExtraction = () => {
    isTerminatedRef.current = true;
    setDocState(prev => ({ ...prev, status: 'idle', progress: 0 }));
    setApiError("Processing terminated by user.");
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    isTerminatedRef.current = false;
    setApiError(null);
    const fileStartTime = Date.now();
    setElapsedTime(0);
    setDocState({
      fileName: file.name,
      pages: [],
      fullText: '',
      status: 'processing',
      progress: 0,
      startTime: fileStartTime,
    });

    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      const totalPages = pdf.numPages;

      const processPage = async (pageNum: number) => {
        if (isTerminatedRef.current) return null;
        
        try {
          const page = await pdf.getPage(pageNum);
          // Scale 1.0 is sufficient for Gemini 3 Flash and minimizes data transfer
          const scale = 1.0; 
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          if (context) {
            await page.render({ canvasContext: context, viewport }).promise;
            const imageData = canvas.toDataURL('image/jpeg', 0.75); // Optimized quality for speed
            
            if (isTerminatedRef.current) return null;

            const pStart = Date.now();
            const text = await performOCR(imageData);
            const duration = Date.now() - pStart;
            
            const newPage: OCRPage = {
              pageNumber: pageNum,
              extractedText: text,
              imagePreview: imageData,
              durationMs: duration,
            };

            if (!isTerminatedRef.current) {
              setDocState(prev => {
                const updatedPages = [...prev.pages, newPage].sort((a, b) => a.pageNumber - b.pageNumber);
                const progress = Math.round((updatedPages.length / totalPages) * 100);
                return { ...prev, pages: updatedPages, progress };
              });
            }
            
            return newPage;
          }
        } catch (err: any) {
          console.error(`Error on page ${pageNum}:`, err);
          throw err; // Propagate to trigger global error state
        }
        return null;
      };

      // Increased concurrency for maximum throughput
      const concurrencyLimit = 12;
      const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
      const results: OCRPage[] = [];
      
      for (let i = 0; i < pageNumbers.length; i += concurrencyLimit) {
        if (isTerminatedRef.current) break;
        const batch = pageNumbers.slice(i, i + concurrencyLimit);
        const batchResults = await Promise.all(batch.map(num => processPage(num)));
        results.push(...batchResults.filter(r => r !== null) as OCRPage[]);
      }

      if (isTerminatedRef.current) return;

      results.sort((a, b) => a.pageNumber - b.pageNumber);
      const fullText = results.map(p => p.extractedText).join('\n\n---\n\n');
      
      setDocState(prev => ({
        ...prev,
        pages: results,
        fullText,
        status: 'completed',
        progress: 100,
        totalDurationMs: Date.now() - fileStartTime,
      }));

    } catch (error: any) {
      console.error("Critical Failure:", error);
      setApiError(error.message || "A critical error occurred during processing.");
      setDocState(prev => ({ ...prev, status: 'error' }));
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!userInput.trim() || isChatLoading || docState.status !== 'completed') return;

    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userInput,
      timestamp: Date.now(),
    };

    setChatMessages(prev => [...prev, newMessage]);
    setUserInput('');
    setIsChatLoading(true);

    try {
      const history = chatMessages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model' as any,
        parts: [{ text: msg.content }]
      }));
      const responseText = await chatWithDocument(history, userInput, docState.fullText);
      setChatMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
      }]);
    } catch (error: any) {
      console.error("Chat Error:", error);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 h-screen overflow-hidden">
      {/* Header */}
      <nav className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 z-50 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-black shadow-lg">L</div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight leading-none">LensOCR <span className="text-indigo-600">Ultra</span></h1>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">Multi-Threaded AI Extraction</p>
          </div>
        </div>

        {docState.status === 'completed' && (
          <div className="flex items-center gap-2">
             <div className="hidden lg:flex flex-col text-right mr-3 leading-none">
                <span className="text-[8px] text-slate-400 font-bold uppercase">Time</span>
                <span className="text-indigo-600 font-black text-xs">{(docState.totalDurationMs! / 1000).toFixed(1)}s</span>
             </div>
             <div className="bg-slate-100 p-1 rounded-xl flex gap-1 border border-slate-200">
                <button onClick={() => downloadAsText(docState.fileName, docState.fullText)} className="px-2 py-1.5 text-[9px] font-bold text-slate-600 hover:bg-white rounded-lg transition-all">TXT</button>
                <button onClick={() => downloadAsHTML(docState.fileName, docState.pages)} className="px-2 py-1.5 text-[9px] font-bold text-emerald-600 hover:bg-white rounded-lg transition-all">HTML</button>
                <button onClick={() => downloadAsWord(docState.fileName, docState.pages)} className="px-2 py-1.5 text-[9px] font-bold text-blue-600 hover:bg-white rounded-lg transition-all">WORD</button>
                <button onClick={() => downloadAsSimplePDF(docState.fileName, docState.pages)} className="px-3 py-1.5 text-[9px] font-bold text-indigo-600 bg-white shadow-sm rounded-lg border border-slate-200">PDF</button>
             </div>
          </div>
        )}
      </nav>

      {apiError && (
        <div className="bg-red-50 border-b border-red-100 px-6 py-2 flex items-center justify-between text-red-700 text-xs font-medium">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
            <span>{apiError}</span>
          </div>
          <button onClick={() => setApiError(null)} className="hover:text-red-900 font-bold">DISMISS</button>
        </div>
      )}

      <main className="flex-1 flex overflow-hidden">
        {/* Workspace */}
        <div className="flex-1 overflow-y-auto bg-slate-100 p-6 relative">
          {docState.status === 'idle' && (
            <div className="h-full flex items-center justify-center">
              <div className="max-w-md w-full text-center bg-white p-10 rounded-[2.5rem] shadow-2xl border border-white">
                <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-8">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                </div>
                <h2 className="text-2xl font-black text-slate-900 mb-3 tracking-tight">LensOCR Ultra</h2>
                <p className="text-slate-500 mb-8 text-sm px-4">Instant parallel OCR for multi-page documents. Captures tables, images, and text block by block.</p>
                <label className="block w-full py-4 bg-indigo-600 text-white rounded-2xl font-black cursor-pointer hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 active:scale-95 text-xs uppercase tracking-widest">
                  Process New Document
                  <input type="file" accept="application/pdf" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
            </div>
          )}

          {docState.status === 'processing' && (
            <div className="h-full flex flex-col items-center justify-center p-4">
               <div className="w-full max-w-xl bg-white p-10 rounded-[3rem] shadow-2xl border border-slate-100 relative overflow-hidden">
                  <div className="absolute top-8 right-10 flex flex-col items-end">
                    <span className="text-3xl font-black text-indigo-600 font-mono">{elapsedTime.toFixed(1)}s</span>
                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Processing Time</span>
                  </div>
                  
                  <h3 className="text-xl font-black text-slate-900 mb-1">Engaging AI Clusters</h3>
                  <p className="text-slate-400 text-[11px] mb-8 font-medium italic">Streaming concurrent pages...</p>
                  
                  <div className="w-full h-3 bg-slate-50 rounded-full overflow-hidden mb-10 flex items-center px-0.5 border">
                     <div className="h-1.5 bg-indigo-600 rounded-full transition-all duration-500 ease-out" style={{ width: `${docState.progress}%` }}></div>
                  </div>

                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mb-10">
                    {docState.pages.map((p) => (
                      <div key={p.pageNumber} className="aspect-[3/4] bg-slate-100 rounded-lg overflow-hidden border border-indigo-200 relative animate-in zoom-in-50 duration-300">
                        <img src={p.imagePreview} className="w-full h-full object-cover opacity-40" />
                        <div className="absolute inset-0 flex items-center justify-center">
                           <div className="w-5 h-5 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-md">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                           </div>
                        </div>
                      </div>
                    ))}
                    <div className="aspect-[3/4] border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center animate-pulse">
                      <div className="w-2 h-2 bg-slate-200 rounded-full"></div>
                    </div>
                  </div>

                  <button 
                    onClick={stopExtraction}
                    className="w-full py-3 bg-red-50 text-red-600 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-red-100 transition-colors border border-red-100"
                  >
                    Terminate Processing
                  </button>
               </div>
            </div>
          )}

          {docState.status === 'completed' && (
            <div className="max-w-5xl mx-auto space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-5 duration-700">
               {/* Dashboard */}
               <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 flex items-center gap-4">
                    <div className="w-10 h-10 bg-green-50 text-green-600 rounded-xl flex items-center justify-center"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg></div>
                    <div className="overflow-hidden"><p className="text-[9px] font-bold text-slate-400 uppercase leading-none mb-1">Extraction Status</p><h4 className="text-base font-black text-slate-800 leading-none">100% Fidelity</h4></div>
                  </div>
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 flex items-center gap-4">
                    <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg></div>
                    <div className="overflow-hidden"><p className="text-[9px] font-bold text-slate-400 uppercase leading-none mb-1">Global Velocity</p><h4 className="text-base font-black text-slate-800 leading-none">{(docState.totalDurationMs! / 1000).toFixed(1)}s Runtime</h4></div>
                  </div>
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 flex items-center gap-4 overflow-hidden">
                    <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg></div>
                    <div className="min-w-0 overflow-hidden"><p className="text-[9px] font-bold text-slate-400 uppercase leading-none mb-1">Document Identity</p><h4 className="text-sm font-black text-slate-800 truncate" title={docState.fileName}>{docState.fileName}</h4></div>
                  </div>
               </div>

               {/* Full Markdown */}
               <div className="bg-white rounded-[2rem] overflow-hidden border border-slate-200 shadow-xl">
                  <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Unified Markdown Stream</span>
                    <button onClick={() => navigator.clipboard.writeText(docState.fullText)} className="text-[9px] font-black text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 hover:bg-indigo-100 transition-colors">COPY RAW CONTENT</button>
                  </div>
                  <div className="p-8 font-mono text-xs leading-relaxed text-slate-600 bg-white max-h-[500px] overflow-y-auto whitespace-pre-wrap break-words">
                    {docState.fullText}
                  </div>
               </div>

               {/* Individual Page Blocks */}
               <div className="space-y-6">
                 {docState.pages.map(page => (
                   <div key={page.pageNumber} className="bg-white rounded-[2rem] border border-slate-200 shadow-sm flex flex-col lg:flex-row overflow-hidden group hover:shadow-lg transition-all">
                      <div className="w-full lg:w-72 shrink-0 bg-slate-100 relative flex items-center justify-center p-6 border-b lg:border-b-0 lg:border-r border-slate-200">
                         <img src={page.imagePreview} className="max-h-64 max-w-full rounded shadow-xl object-contain" alt="" />
                         <div className="absolute top-4 left-4 bg-indigo-600 text-white text-[9px] font-black px-2 py-1 rounded shadow">PAGE {page.pageNumber}</div>
                      </div>
                      <div className="flex-1 flex flex-col min-w-0">
                         <div className="px-6 py-3 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Data Block</span>
                            <span className="text-[10px] font-mono font-black text-indigo-500">{(page.durationMs! / 1000).toFixed(2)}s Performance</span>
                         </div>
                         <div className="flex-1 overflow-y-auto p-6 text-[11px] font-mono text-slate-600 whitespace-pre-wrap leading-relaxed break-words max-h-64">
                            {page.extractedText}
                         </div>
                      </div>
                   </div>
                 ))}
               </div>
            </div>
          )}

          {docState.status === 'error' && (
            <div className="h-full flex items-center justify-center">
               <div className="bg-white p-10 rounded-3xl shadow-xl border border-red-100 text-center max-w-md">
                  <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  </div>
                  <h3 className="text-xl font-black text-slate-900 mb-2">Process Failure</h3>
                  <p className="text-slate-500 text-xs mb-8">{apiError || "An unexpected error occurred."}</p>
                  <button onClick={() => window.location.reload()} className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase tracking-widest">Reset Application</button>
               </div>
            </div>
          )}
        </div>

        {/* AI Assistant */}
        <div className="w-[360px] shrink-0 bg-white border-l border-slate-200 flex flex-col shadow-[-15px_0_30px_rgba(0,0,0,0.02)] z-40">
           <div className="h-16 border-b border-slate-100 px-6 flex items-center justify-between">
              <h3 className="font-black text-slate-800 text-[10px] uppercase tracking-widest">Document Intelligence</h3>
              {docState.status === 'completed' && (
                <div className="flex items-center gap-1.5 bg-indigo-50 px-2 py-1 rounded-full border border-indigo-100">
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse"></div>
                  <span className="text-[8px] font-black text-indigo-600 uppercase">Synced</span>
                </div>
              )}
           </div>

           <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/20 scroll-smooth">
              {chatMessages.length === 0 && (
                <div className="text-center pt-12">
                   <div className="w-16 h-16 bg-white border border-slate-100 shadow-lg rounded-2xl flex items-center justify-center mx-auto mb-6 text-slate-200">
                     <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"/></svg>
                   </div>
                   <h4 className="text-slate-900 font-black text-xs mb-2 uppercase tracking-tight">Advanced Querying</h4>
                   <p className="text-slate-400 text-[10px] leading-relaxed italic px-4">
                     {docState.status === 'completed' 
                       ? "The document's text, tables, and visual blocks are fully indexed. Ask me for summaries or specific data points."
                       : "Conversational intelligence will activate upon completion of the extraction stream."}
                   </p>
                </div>
              )}

              {chatMessages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in duration-300`}>
                   <div className={`max-w-[90%] px-4 py-3 rounded-2xl text-[13px] leading-relaxed shadow-sm break-words ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none'}`}>
                     {msg.content}
                   </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                   <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm flex gap-1.5 items-center">
                      <div className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce"></div>
                      <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-150"></div>
                      <div className="w-1.5 h-1.5 bg-indigo-700 rounded-full animate-bounce delay-300"></div>
                   </div>
                </div>
              )}
              <div ref={chatEndRef} />
           </div>

           <div className="p-6 border-t border-slate-100 bg-white shrink-0">
              <form onSubmit={handleSendMessage} className="relative group">
                 <textarea 
                   rows={1}
                   disabled={docState.status !== 'completed' || isChatLoading}
                   value={userInput}
                   onChange={e => setUserInput(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                   placeholder={docState.status === 'completed' ? "Search extracted content..." : "Indexing data..."}
                   className="w-full pl-4 pr-12 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs focus:ring-4 focus:ring-indigo-500/10 focus:bg-white focus:border-indigo-500 outline-none transition-all disabled:opacity-50 resize-none min-h-[50px] leading-tight"
                 />
                 <button 
                   type="submit"
                   disabled={!userInput.trim() || isChatLoading || docState.status !== 'completed'}
                   className="absolute right-2 bottom-2 p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:bg-slate-300 shadow-xl transition-all active:scale-90"
                 >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
                 </button>
              </form>
           </div>
        </div>
      </main>
    </div>
  );
};

export default App;
