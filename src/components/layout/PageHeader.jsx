import React from 'react';
import { motion } from 'framer-motion';

const PageHeader = ({ icon: Icon, title, description, gradientText, iconColor = 'text-blue-400' }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="text-center mb-12 md:mb-16"
    >
      {Icon && (
        <div className={`inline-block p-4 rounded-full mb-4 bg-white/10`}>
          <Icon className={`w-10 h-10 ${iconColor}`} />
        </div>
      )}
      <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-4">
        {title} {gradientText && <span className="gradient-text">{gradientText}</span>}
      </h1>
      {description && (
        <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
          {description}
        </p>
      )}
    </motion.div>
  );
};

export default PageHeader;