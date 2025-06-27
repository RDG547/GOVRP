import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const StatCard = ({ icon: Icon, title, value }) => {
    return (
        <Card className="glass-effect border-white/10 text-white">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-gray-300">{title}</CardTitle>
                <Icon className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent>
                <div className="text-3xl font-bold">{value !== null ? value.toLocaleString('pt-BR') : '...'}</div>
            </CardContent>
        </Card>
    );
};

export default StatCard;