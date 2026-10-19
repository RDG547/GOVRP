import React,{useState} from 'react';
import {Link} from 'react-router-dom';
import {Bell,Trash2,MailCheck} from 'lucide-react';
import {Popover,PopoverTrigger,PopoverContent} from '@/components/ui/popover';
import {Button} from '@/components/ui/button';
import NotificationIcon from './NotificationIcon';
import {useNotifications} from '@/contexts/NotificationsContext';
import {notificationText,notificationDestination} from '@/lib/notificationPresentation';
import {formatDistanceToNow} from 'date-fns';
import {ptBR} from 'date-fns/locale';
import {useToast} from '@/components/ui/use-toast';
export default function NotificationBell(){
 const feed=useNotifications(),{toast}=useToast();const [open,setOpen]=useState(false);
 return <Popover open={open} onOpenChange={next=>{setOpen(next);if(next)void feed.refresh();}}><PopoverTrigger asChild><button aria-label="Notificações" className="relative text-foreground hover:text-primary"><Bell className="h-6 w-6"/>{feed.unread>0&&<span className="absolute -right-2 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs text-white">{feed.unread}</span>}</button></PopoverTrigger><PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0"><header className="flex items-center justify-between border-b p-4"><h3 className="font-semibold">Notificações</h3>{feed.items.length>0&&<Button size="sm" variant="ghost" onClick={async()=>{try{await feed.clear();}catch{toast({title:'Não foi possível limpar as notificações',variant:'destructive'});}}}><Trash2 className="mr-2 h-4 w-4"/>Limpar tudo</Button>}</header><div className="max-h-96 overflow-y-auto">{feed.items.slice(0,20).map(n=><Link key={n.id} to={notificationDestination(n)} onClick={()=>{void feed.markRead(n.id);setOpen(false);}} className="flex gap-3 border-b p-4 hover:bg-accent"><NotificationIcon notification={n}/><div className="min-w-0 flex-1"><p className="break-words text-sm">{notificationText(n)}</p><p className="mt-1 text-xs text-muted-foreground">{formatDistanceToNow(new Date(n.created_at),{addSuffix:true,locale:ptBR})}</p></div>{!n.is_read&&<span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary"/>}</Link>)}{!feed.items.length&&<p className="p-8 text-center"><MailCheck className="mx-auto mb-3 h-8 w-8"/>Tudo em dia!</p>}</div>{feed.unread>0&&<Button variant="ghost" className="w-full" onClick={()=>feed.markRead()}>Marcar todas como lidas</Button>}</PopoverContent></Popover>;
}
