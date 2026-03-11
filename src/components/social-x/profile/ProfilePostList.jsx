import React from 'react';
import PostCard from '@/components/social-x/PostCard';
import { motion, AnimatePresence } from 'framer-motion';

const ProfilePostList = ({ posts, onPostUpdate, onPostDelete }) => {
    return (
        <div className="mt-4">
            {posts.length > 0 ? (
                <AnimatePresence>
                    {posts.map(post => (
                        <motion.div key={post.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <PostCard
                                post={post}
                                onPostUpdate={onPostUpdate}
                                onPostDelete={onPostDelete}
                            />
                        </motion.div>
                    ))}
                </AnimatePresence>
            ) : (
                <div className="text-center py-16 text-gray-400 glass-effect rounded-2xl">
                    <p>Este usuário ainda não fez nenhuma publicação.</p>
                </div>
            )}
        </div>
    );
};

export default ProfilePostList;