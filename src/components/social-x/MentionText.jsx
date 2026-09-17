import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';

export default function MentionText({ text = '' }) {
  const [valid, setValid] = useState(new Set());
  const content = String(text || '');
  const handles = [...new Set([...content.matchAll(/(?:^|\s)@([\w.]+)/g)].map(match => match[1]))].slice(0, 100);
  const key = JSON.stringify(handles);
  useEffect(() => {
    let active = true;
    if (!JSON.parse(key).length) { setValid(new Set()); return; }
    void supabase.rpc('resolve_x_mentions', { p_handles: JSON.parse(key) }).then(result => { if (active) setValid(new Set((result.data || []).map(row => row.x_handle))); });
    return () => { active = false; };
  }, [key]);
  return content.split(/((?:^|\s)@[\w.]+)/g).map((part, index) => {
    const handle = part.trim().slice(1);
    return part.trim().startsWith('@') && valid.has(handle) ? <React.Fragment key={index}>{part.slice(0, part.indexOf('@'))}<Link className="text-sky-400 hover:underline focus-visible:outline no-navigate" to={`/services/x/profile/${handle}`} onClick={event => event.stopPropagation()}>@{handle}</Link></React.Fragment> : part;
  });
}
