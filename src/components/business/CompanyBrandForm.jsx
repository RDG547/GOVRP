import React, { useState } from 'react';
import { Loader2, Palette, Save } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { buildStoragePath } from '@/lib/security';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import ImageUploader from '@/components/ImageUploader';
import BrandFontPicker from '@/components/BrandFontPicker';
import { Button } from '@/components/ui/button';
export default function CompanyBrandForm({ company, onSaved }) {
 const {user}=useAuth(),{toast}=useToast();
 const [draft,setDraft]=useState({logo_url:company.logo_url||'',font_key:company.font_key,color:company.brand_color}),[file,setFile]=useState(null),[busy,setBusy]=useState(false);
 const save=async()=>{if(busy)return;setBusy(true);try{let logo=draft.logo_url;if(file){const r=await supabase.storage.from('public-assets').upload(buildStoragePath({prefix:'company-logos',entityId:user.id,fileName:file.name}),file);if(r.error)throw r.error;logo=supabase.storage.from('public-assets').getPublicUrl(r.data.path).data.publicUrl;}const r=await supabase.rpc('update_company_brand',{p_business_id:company.id,p_brand:{...draft,logo_url:logo}});if(r.error)throw r.error;setDraft({...draft,logo_url:logo});setFile(null);await onSaved();toast({title:'Identidade da empresa salva'});}catch(error){toast({title:'Não foi possível salvar',description:error.message,variant:'destructive'});}finally{setBusy(false);}};
 return <section className="space-y-4 rounded-xl border p-4"><h2 className="flex gap-2 font-semibold"><Palette className="h-5 w-5"/>Personalização da empresa</h2><ImageUploader previewOnly label="Logo da empresa" initialUrl={draft.logo_url} onUrlChange={logo_url=>setDraft({...draft,logo_url})} onFileChange={setFile}/><label className="flex items-center gap-3 text-sm">Cor da marca<input aria-label="Cor da marca" type="color" value={draft.color} onChange={e=>setDraft({...draft,color:e.target.value})} className="h-11 w-16 cursor-pointer rounded border"/></label><BrandFontPicker name={company.name} value={draft.font_key} onChange={font_key=>setDraft({...draft,font_key})}/><Button disabled={busy} onClick={save}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Salvar identidade</Button></section>;
}
