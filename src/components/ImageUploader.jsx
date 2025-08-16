import React, { useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Upload, Link as LinkIcon, X } from 'lucide-react';
import { Label } from './ui/label';

const ImageUploader = ({ onUrlChange, onFileChange, initialUrl = '', label = "Imagem" }) => {
  const [url, setUrl] = useState(initialUrl);
  const [file, setFile] = useState(null);
  const fileInputRef = useRef(null);

  const handleUrlChange = (e) => {
    const newUrl = e.target.value;
    setUrl(newUrl);
    onUrlChange(newUrl);
    if (file) {
      setFile(null);
      onFileChange(null);
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      onFileChange(selectedFile);
      setUrl('');
      onUrlChange('');
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current.click();
  };

  const handleClearFile = () => {
    setFile(null);
    onFileChange(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <div className="relative flex-grow">
          <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Cole uma URL ou faça upload"
            value={file ? file.name : url}
            onChange={handleUrlChange}
            readOnly={!!file}
            className="pl-10"
          />
        </div>
        {file ? (
          <Button type="button" variant="destructive" size="icon" onClick={handleClearFile}>
            <X className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="button" variant="outline" size="icon" onClick={handleUploadClick}>
            <Upload className="h-4 w-4" />
          </Button>
        )}
      </div>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*"
      />
    </div>
  );
};

export default ImageUploader;