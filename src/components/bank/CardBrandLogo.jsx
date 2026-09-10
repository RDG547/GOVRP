import React from 'react';
import { FaCcMastercard, FaCcVisa } from 'react-icons/fa';
export default function CardBrandLogo({ brand, className = 'h-6 w-8' }) {
  return String(brand).toLowerCase() === 'mastercard'
    ? <FaCcMastercard aria-label="Mastercard" className={`${className} text-orange-400`} />
    : <FaCcVisa aria-label="Visa" className={`${className} text-blue-300`} />;
}
