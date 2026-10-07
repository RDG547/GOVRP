import React, { useEffect, useRef, useState } from 'react';
import { Upload, Link as LinkIcon, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from './ui/label';
import {
  ACCEPTED_IMAGE_EXTENSIONS,
  ACCEPTED_IMAGE_MIME_TYPES,
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_STANDARD_IMAGE_UPLOAD_BYTES,
  validateRemoteAssetUrl,
  validateSelectedFile,
} from '@/lib/security';

const ImageUploader = ({
  onUrlChange,
  onFileChange,
  initialUrl = '',
  label = 'Imagem',
  labelIcon: LabelIcon,
  previewOnly = false,
  banner = false,
  allowRemove = false,
  accept = IMAGE_ACCEPT_ATTRIBUTE,
  allowedMimeTypes = ACCEPTED_IMAGE_MIME_TYPES,
  allowedExtensions = ACCEPTED_IMAGE_EXTENSIONS,
  maxFileSize = MAX_STANDARD_IMAGE_UPLOAD_BYTES,
}) => {
  const [url, setUrl] = useState(initialUrl);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(initialUrl);
  const [editUrl, setEditUrl] = useState(false);
  useEffect(() => {
    if (!file) { setPreview(url); return; }
    const objectUrl = URL.createObjectURL(file); setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, url]);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    setUrl(initialUrl);
    if (initialUrl) setFile(null);
    setError('');
  }, [initialUrl]);

  const handleUrlChange = (e) => {
    const newUrl = e.target.value;
    setUrl(newUrl);

    const validation = validateRemoteAssetUrl(newUrl);

    if (!validation.ok) {
      setError(validation.error);
      onUrlChange?.('');
      return;
    }

    setError('');
    onUrlChange?.(validation.value);

    if (file) {
      setFile(null);
      onFileChange?.(null);
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    const validation = validateSelectedFile(selectedFile, {
      allowedMimeTypes,
      allowedExtensions,
      maxBytes: maxFileSize,
      label: 'imagem',
    });

    if (!validation.ok) {
      setError(validation.error);
      onFileChange?.(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    setError('');
    setFile(selectedFile);
    onFileChange?.(selectedFile);
    setUrl('');
    onUrlChange?.('');
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleClearFile = () => {
    setFile(null);
    setError('');
    onFileChange?.(null);
    setUrl('');
    onUrlChange?.('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <Label className="inline-flex items-center gap-2">{LabelIcon&&<LabelIcon className="h-4 w-4"/>}{label}</Label>
      {previewOnly && preview && <img src={preview} alt={`Prévia: ${label}`} className={banner ? "aspect-[3/1] w-full rounded-lg border object-cover" : "h-24 w-24 rounded-lg border object-contain"}/>}
      {previewOnly && !editUrl && <Button type="button" variant="ghost" size="sm" onClick={() => setEditUrl(true)}><LinkIcon className="mr-2 h-4 w-4"/>Alterar por link</Button>}
      <div className="flex items-center gap-2">
        <div className={`relative min-w-0 flex-grow ${previewOnly && !editUrl ? 'hidden' : ''}`}>
          <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Cole uma URL HTTPS ou faça upload"
            value={file ? file.name : url}
            onChange={handleUrlChange}
            readOnly={!!file}
            className="pl-10"
          />
        </div>
        <Button type="button" variant="outline" size="sm" aria-label={`Enviar ${label}`} onClick={handleUploadClick}><Upload className="mr-2 h-4 w-4"/>{preview ? 'Alterar imagem' : 'Enviar imagem'}</Button>
        {(file || (allowRemove && preview)) && <Button type="button" variant="ghost" size="sm" aria-label={`Remover ${label}`} onClick={handleClearFile}><X className="mr-2 h-4 w-4"/>Remover</Button>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept={accept}
      />
    </div>
  );
};

export default ImageUploader;
