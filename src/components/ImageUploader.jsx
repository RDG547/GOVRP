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
  snapshotSelectedImageFile,
} from '@/lib/security';

const ImageUploader = ({
  onUrlChange,
  onFileChange,
  cacheSelectedFile = false,
  onPreparingChange,
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
  const [preparing, setPreparing] = useState(false);
  const fileInputRef = useRef(null);
  const selectionSequence = useRef(0);
  useEffect(() => () => { selectionSequence.current += 1; }, []);

  useEffect(() => {
    setUrl(initialUrl);
    if (initialUrl) setFile(null);
    setError('');
  }, [initialUrl]);

  const handleUrlChange = (e) => {
    selectionSequence.current += 1;
    setPreparing(false);
    onPreparingChange?.(false);
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

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Allow selecting the same photo again after a permission/read failure.
    e.target.value = '';
    const sequence = ++selectionSequence.current;
    const validation = validateSelectedFile(selectedFile, {
      // When caching, inspect actual bytes regardless of the MIME/extension
      // reported by Android's content provider (which may use .bin/text/plain).
      allowedMimeTypes: cacheSelectedFile ? [] : allowedMimeTypes,
      allowedExtensions: cacheSelectedFile ? [] : allowedExtensions,
      maxBytes: maxFileSize,
      label: 'imagem',
    });

    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setError('');
    if (!cacheSelectedFile) {
      setFile(selectedFile);
      onFileChange?.(selectedFile);
      setUrl('');
      onUrlChange?.('');
      return;
    }

    setPreparing(true);
    onPreparingChange?.(true);
    try {
      // Capture while the picker still grants file access, not minutes later
      // when the user finally presses "Anunciar Produto".
      const localCopy = await snapshotSelectedImageFile(selectedFile);
      if (sequence !== selectionSequence.current) return;
      setFile(localCopy);
      onFileChange?.(localCopy);
      setUrl('');
      onUrlChange?.('');
    } catch (readError) {
      if (sequence !== selectionSequence.current) return;
      console.warn('image-picker-read', readError);
      setError('Não foi possível acessar a foto selecionada. Escolha a imagem novamente pela Galeria ou Arquivos. Seus dados do anúncio foram preservados.');
    } finally {
      if (sequence === selectionSequence.current) {
        setPreparing(false);
        onPreparingChange?.(false);
      }
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleClearFile = () => {
    selectionSequence.current += 1;
    setPreparing(false);
    onPreparingChange?.(false);
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
        <Button type="button" variant="outline" size="sm" disabled={preparing} aria-label={`Enviar ${label}`} onClick={handleUploadClick}><Upload className="mr-2 h-4 w-4"/>{preparing ? 'Lendo imagem...' : preview ? 'Alterar imagem' : 'Enviar imagem'}</Button>
        {(file || (allowRemove && preview)) && <Button type="button" variant="ghost" size="sm" aria-label={`Remover ${label}`} onClick={handleClearFile}><X className="mr-2 h-4 w-4"/>Remover</Button>}
      </div>
      {preparing && <p role="status" className="text-xs text-muted-foreground">Preparando imagem selecionada...</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
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
