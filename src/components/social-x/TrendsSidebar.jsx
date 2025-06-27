import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

const TrendsSidebar = () => {
    const [trends, setTrends] = useState([]);

    const fetchTrends = useCallback(async () => {
        const { data, error } = await supabase.from('trends').select('*').order('post_count', { ascending: false }).limit(5);
        if (error) {
            console.error("Error fetching trends:", error);
        } else {
            setTrends(data);
        }
    }, []);

    useEffect(() => {
        fetchTrends();
    }, [fetchTrends]);

    return (
        <aside className="lg:col-span-1 space-y-6 hidden lg:block">
            <div className="sticky top-24">
                <Card className="border-slate-700/50">
                    <CardContent className="p-4">
                        <h3 className="text-xl font-bold text-white flex items-center gap-2"><TrendingUp /> Tendências</h3>
                        <ul className="mt-4 space-y-2">
                            {trends.map(trend => (
                                <li key={trend.hashtag} className="text-white hover:bg-white/5 p-2 rounded-md cursor-pointer">
                                    <p className="font-bold">#{trend.hashtag}</p>
                                    <p className="text-sm text-gray-400">{trend.post_count} posts</p>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            </div>
        </aside>
    );
};

export default TrendsSidebar;