import React, { useState } from 'react';
import { Palette, Save, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { buildStoragePath } from '@/lib/security';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import ImageUploader from '@/components/ImageUploader';
import BrandFontPicker from '@/components/BrandFontPicker';
import PartyColorPicker from './PartyColorPicker';
export default function PartyCustomizationForm({ party, onAction }) {
  const { toast } = useToast();
  const [draft,setDraft]=useState({...party.customization,logo_url:party.logo_url||'',primary_color:party.color||'#64748B',font_key:party.customization?.font_key||'default'});
  const [logoFile,setLogoFile]=useState(null);
  const [file,setFile]=useState(null),[busy,setBusy]=useState(false);
  const save=async()=>{setBusy(true);try{let logo=draft.logo_url||'';if(logoFile){const r=await supabase.storage.from('public-assets').upload(buildStoragePath({prefix:'party-logos',entityId:party.id,fileName:logoFile.name}),logoFile);if(r.error)throw r.error;logo=supabase.storage.from('public-assets').getPublicUrl(r.data.path).data.publicUrl;}let header=draft.header_url||'';if(file){const {data,error}=await supabase.storage.from('public-assets').upload(buildStoragePath({prefix:'party-headers',entityId:party.id,fileName:file.name}),file);if(error)throw error;header=supabase.storage.from('public-assets').getPublicUrl(data.path).data.publicUrl;}const {data,error}=await supabase.rpc('update_party_customization',{p_party_id:party.id,p_customization:{...draft,header_url:header,logo_url:logo}});if(error||!data?.success)throw error||new Error(data?.message);toast({title:'Personalização salva'});onAction?.();}catch(error){toast({title:'Não foi possível salvar',description:error.message,variant:'destructive'});}finally{setBusy(false);}};
  return <section className="space-y-4"><h3 className="flex items-center gap-2 font-semibold"><Palette className="h-5 w-5"/>Personalização</h3><ImageUploader previewOnly label="Logo do partido" initialUrl={draft.logo_url} onFileChange={setLogoFile} onUrlChange={logo_url=>setDraft({...draft,logo_url})}/><ImageUploader previewOnly label="Capa do partido" initialUrl={draft.header_url||''} onFileChange={setFile} onUrlChange={header_url=>setDraft({...draft,header_url})}/><Button variant="ghost" onClick={()=>{setFile(null);setDraft({...draft,header_url:''});}}><X className="mr-2 h-4 w-4"/>Remover capa</Button><PartyColorPicker value={draft.primary_color} onChange={primary_color=>setDraft({...draft,primary_color})} party={{...party,logo_url:draft.logo_url}}/><BrandFontPicker value={draft.font_key} onChange={font_key=>setDraft({...draft,font_key})} name={party.name}/><Button disabled={busy} onClick={save}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Salvar personalização</Button></section>;
}
