import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Info } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const PartyDetailsDialog = ({ party }) => (
    <Dialog>
        <DialogTrigger asChild><Button variant="outline" className="w-full"><Info className="mr-2 h-4 w-4" />Detalhes</Button></DialogTrigger>
        <DialogContent className="glass-effect max-h-[90vh] overflow-y-auto">
            <DialogHeader>
                <div className="flex items-center gap-4 mb-4">
                    <img src={party.logo_url || `https://api.dicebear.com/7.x/initials/svg?seed=${party.acronym}`} alt={party.name} className="w-20 h-20 rounded-lg bg-secondary p-1 object-cover" />
                    <div>
                        <DialogTitle className="text-2xl">{party.name} ({party.acronym})</DialogTitle>
                        <DialogDescription>{party.description}</DialogDescription>
                        <p className="text-sm font-semibold text-primary mt-1">{party.orientation}</p>
                    </div>
                </div>
            </DialogHeader>
            <Tabs defaultValue="info" className="w-full">
                <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="info">Informações</TabsTrigger><TabsTrigger value="members">Membros</TabsTrigger></TabsList>
                <TabsContent value="info" className="mt-4 space-y-4">
                    <div><h4 className="font-semibold">Fundado em</h4><p className="text-muted-foreground">{format(new Date(party.created_at), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</p></div>
                    <div><h4 className="font-semibold">Fundador</h4><p className="text-muted-foreground">{party.founder?.full_name || 'Não definido'}</p></div>
                    <div><h4 className="font-semibold">Presidente</h4><p className="text-muted-foreground">{party.president?.full_name || 'Não definido'}</p></div>
                    <div><h4 className="font-semibold">Vice-Presidente</h4><p className="text-muted-foreground">{party.vice_president?.full_name || 'Não definido'}</p></div>
                    <div><h4 className="font-semibold">Ideologia</h4><p className="text-muted-foreground whitespace-pre-wrap text-sm">{party.ideology || 'Não informada'}</p></div>
                    <div><h4 className="font-semibold">Estatuto do Partido</h4><p className="text-muted-foreground whitespace-pre-wrap text-sm max-h-40 overflow-y-auto">{party.statute || 'Não informado'}</p></div>
                </TabsContent>
                <TabsContent value="members" className="mt-4"><div className="space-y-2 max-h-60 overflow-y-auto">{(party.members || []).map(member => (<div key={member.user_id} className="flex items-center justify-between p-2 rounded bg-black/20"><span>{member.profiles.full_name}</span><span className="text-sm text-muted-foreground">{member.role}</span></div>))}</div></TabsContent>
            </Tabs>
        </DialogContent>
    </Dialog>
);

export default PartyDetailsDialog;