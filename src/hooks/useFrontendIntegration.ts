/**
 * React хук для интеграции агента с фронтендом
 * Регистрирует коллбеки для управления UI через агента
 */

import { useEffect, useCallback } from 'react';
import { frontendNavigationService } from '../services/frontendNavigationService';

export interface FrontendCallbacks {
  setActiveTab: (tabId: string) => void;
  setActiveSubTab?: (subTabId: string) => void;
  setSelectedCategory?: (categoryId: string) => void;
  setSelectedProduct?: (productId: string) => void;
  setSearchQuery?: (query: string) => void;
  applyFilters?: (filters: Record<string, any>) => void;
  getScreenData?: () => any;
  getSelectedItems?: () => any;
  // Динамические действия
  [key: string]: any;
}

export function useFrontendIntegration(callbacks: FrontendCallbacks) {
  const registerCallbacks = useCallback(() => {
    // Регистрация основных коллбеков
    if (callbacks.setActiveTab) {
      frontendNavigationService.registerCallback('setActiveTab', callbacks.setActiveTab);
    }
    
    if (callbacks.setActiveSubTab) {
      frontendNavigationService.registerCallback('setActiveSubTab', callbacks.setActiveSubTab);
    }
    
    if (callbacks.setSelectedCategory) {
      frontendNavigationService.registerCallback('setSelectedCategory', callbacks.setSelectedCategory);
    }
    
    if (callbacks.setSelectedProduct) {
      frontendNavigationService.registerCallback('setSelectedProduct', callbacks.setSelectedProduct);
    }
    
    if (callbacks.setSearchQuery) {
      frontendNavigationService.registerCallback('setSearchQuery', callbacks.setSearchQuery);
    }
    
    if (callbacks.applyFilters) {
      frontendNavigationService.registerCallback('applyFilters', callbacks.applyFilters);
    }
    
    if (callbacks.getScreenData) {
      frontendNavigationService.registerCallback('getScreenData', callbacks.getScreenData);
    }
    
    if (callbacks.getSelectedItems) {
      frontendNavigationService.registerCallback('getSelectedItems', callbacks.getSelectedItems);
    }
    
    // Регистрация динамических действий (например click_*)
    Object.keys(callbacks).forEach(key => {
      if (key.startsWith('click_') || key.startsWith('action_')) {
        frontendNavigationService.registerCallback(key, callbacks[key]);
      }
    });
    
    console.log('✅ Frontend integration registered');
  }, [callbacks]);

  useEffect(() => {
    registerCallbacks();
  }, [registerCallbacks]);
  
  return {
    navigationService: frontendNavigationService
  };
}

/**
 * Хелпер для создания функции получения данных с экрана
 */
export function createScreenDataGetter(
  getCurrentTab: () => string,
  getCurrentData: () => any
) {
  return () => {
    const tab = getCurrentTab();
    const data = getCurrentData();
    
    return {
      currentTab: tab,
      data,
      timestamp: Date.now()
    };
  };
}

/**
 * Хелпер для создания функции получения выбранных элементов
 */
export function createSelectedItemsGetter(
  getSelectedProducts?: () => any[],
  getSelectedCategories?: () => any[],
  getSelectedOther?: () => Record<string, any>
) {
  return () => {
    return {
      products: getSelectedProducts?.() || [],
      categories: getSelectedCategories?.() || [],
      other: getSelectedOther?.() || {},
      timestamp: Date.now()
    };
  };
}

