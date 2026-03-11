import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Play, Pause, Volume2, VolumeX, Trash2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

const StoryViewer = ({ stories, initialStoryIndex, onClose, onAction }) => {
  const [currentStoryIndex, setCurrentStoryIndex] = useState(initialStoryIndex);
  const [currentStoryItemIndex, setCurrentStoryItemIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const videoRef = useRef(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const currentStorySet = stories[currentStoryIndex];
  const currentStoryItem = currentStorySet?.stories[currentStoryItemIndex];

  useEffect(() => {
    if (!currentStoryItem || isPaused) return;

    setProgress(0);
    const timer = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(timer);
          return 100;
        }
        const duration = currentStoryItem.media_type === 'video' && videoRef.current ? videoRef.current.duration * 1000 : 5000;
        return prev + (100 / (duration / 100));
      });
    }, 100);

    return () => clearInterval(timer);
  }, [currentStoryItemIndex, currentStoryIndex, isPaused, currentStoryItem]);

  useEffect(() => {
    if (progress >= 100) {
      if (currentStoryItemIndex < currentStorySet.stories.length - 1) {
        setCurrentStoryItemIndex(prev => prev + 1);
      } else {
        if (currentStoryIndex < stories.length - 1) {
          setCurrentStoryIndex(prev => prev + 1);
          setCurrentStoryItemIndex(0);
        } else {
          onClose();
        }
      }
    }
  }, [progress, currentStoryItemIndex, currentStoryIndex, currentStorySet, stories.length, onClose]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const goToNextStorySet = () => {
    if (currentStoryIndex < stories.length - 1) {
      setCurrentStoryIndex(prev => prev + 1);
      setCurrentStoryItemIndex(0);
    } else {
      onClose();
    }
  };

  const goToPrevStorySet = () => {
    if (currentStoryIndex > 0) {
      setCurrentStoryIndex(prev => prev - 1);
      setCurrentStoryItemIndex(0);
    }
  };

  const handleVideoPlay = () => {
    if (videoRef.current) {
      if (isPaused) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
      setIsPaused(!isPaused);
    }
  };

  const handleDeleteStory = async () => {
    if (!currentStoryItem) return;

    const { data, error } = await supabase.rpc('delete_story', { p_story_id: currentStoryItem.id });

    if (error || !data.success) {
      toast({ title: "Erro ao deletar story", description: data?.message || error.message, variant: "destructive" });
    } else {
      toast({ title: "Story deletado com sucesso!" });
      if(onAction) onAction();
      onClose();
    }
  };

  if (!currentStorySet || !currentStoryItem) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
      onMouseDown={() => setIsPaused(true)}
      onMouseUp={() => setIsPaused(false)}
      onTouchStart={() => setIsPaused(true)}
      onTouchEnd={() => setIsPaused(false)}
    >
      <div className="relative w-full max-w-[400px] aspect-[9/16] bg-black rounded-lg overflow-hidden shadow-2xl">
        <AnimatePresence>
          <motion.div
            key={`${currentStoryIndex}-${currentStoryItemIndex}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0"
          >
            {currentStoryItem.media_type === 'image' && (
              <img className="w-full h-full object-cover" alt={`Story de ${currentStorySet.author_username}`} src={currentStoryItem.media_url} />
            )}
            {currentStoryItem.media_type === 'video' && (
              <div className="relative w-full h-full">
                <video
                  ref={videoRef}
                  src={currentStoryItem.media_url}
                  className="w-full h-full object-cover"
                  autoPlay
                  playsInline
                  muted={isMuted}
                  onPlay={() => setIsPaused(false)}
                  onPause={() => setIsPaused(true)}
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/20" onClick={handleVideoPlay}>
                  {isPaused && <Play className="w-16 h-16 text-white/70" />}
                </div>
              </div>
            )}
            {currentStoryItem.media_type === 'text' && (
              <div className="w-full h-full flex items-center justify-center p-8 bg-gradient-to-br from-blue-500 to-purple-600">
                <p className="text-white text-2xl font-bold text-center">{currentStoryItem.content}</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="absolute top-0 left-0 right-0 p-4 z-10 bg-gradient-to-b from-black/50 to-transparent">
          <div className="flex items-center gap-2 mb-2">
            {currentStorySet.stories.map((_, index) => (
              <div key={index} className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white"
                  style={{ width: `${index < currentStoryItemIndex ? 100 : index === currentStoryItemIndex ? progress : 0}%` }}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src={currentStorySet.author_avatar} alt={currentStorySet.author_username} className="w-8 h-8 rounded-full" />
              <span className="text-white font-semibold text-sm">{currentStorySet.author_username}</span>
            </div>
            <div className="flex items-center gap-2">
              {currentStoryItem.media_type === 'video' && (
                <button onClick={() => setIsMuted(!isMuted)} className="text-white">
                  {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
              )}
              <button onClick={onClose} className="text-white">
                <X size={24} />
              </button>
            </div>
          </div>
        </div>
        
        {user?.id === currentStorySet.user_id && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
               <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="bg-red-600/80 p-3 rounded-lg backdrop-blur-sm">
                        <Trash2 className="w-6 h-6 text-white" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta ação não pode ser desfeita. Isso irá deletar permanentemente o seu story.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDeleteStory} className="bg-red-600 hover:bg-red-700">Deletar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
            </div>
        )}
      </div>

      <button onClick={goToPrevStorySet} className="absolute left-4 top-1/2 -translate-y-1/2 text-white bg-black/30 rounded-full p-2 hidden md:block">
        <ChevronLeft size={32} />
      </button>
      <button onClick={goToNextStorySet} className="absolute right-4 top-1/2 -translate-y-1/2 text-white bg-black/30 rounded-full p-2 hidden md:block">
        <ChevronRight size={32} />
      </button>
    </motion.div>
  );
};

export default StoryViewer;