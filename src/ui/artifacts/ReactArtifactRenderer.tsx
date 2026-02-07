/**
 * Рендерер для React artifacts с sandbox
 * ВАЖНО: Валидация React кода перед рендерингом
 */

import React, { useRef, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ArtifactContent } from '../../services/artifacts/types';
import { validateReactCode } from '../../services/artifacts/reactValidator';

interface ReactArtifactRendererProps {
  artifact: ArtifactContent;
}

export const ReactArtifactRenderer: React.FC<ReactArtifactRendererProps> = ({ artifact }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [validation, setValidation] = useState(() => {
    if (!artifact.content || typeof artifact.content !== 'string') {
      return { valid: false, errors: ['Artifact content is missing or invalid'], warnings: [] as string[] };
    }
    const result = validateReactCode(artifact.content);
    return { ...result, warnings: [] as string[] };
  });
  const [isRendered, setIsRendered] = useState(false);
  const [iframeHeight, setIframeHeight] = useState<number>(600);

  // Функция для обработки импортов и определения нужных библиотек
  const processImports = (code: string): {
    processedCode: string;
    requiredLibs: Array<{ name: string; url: string; globalVar: string }>;
    importedHooks: Set<string>; // Отслеживаем какие хуки были импортированы из React
  } => {
    const requiredLibs: Array<{ name: string; url: string; globalVar: string }> = [];
    const importedHooks = new Set<string>();

    // Проверяем, что код существует и является строкой
    if (!code || typeof code !== 'string') {
      return { processedCode: code || '', requiredLibs, importedHooks };
    }

    let processedCode = code;

    // Маппинг библиотек на CDN URLs и глобальные переменные
    const libMap: Record<string, { url: string; globalVar: string }> = {
      'recharts': {
        url: 'https://unpkg.com/recharts@2.8.0/umd/Recharts.js',
        globalVar: 'Recharts'
      },
      'react-is': {
        url: 'https://unpkg.com/react-is@18.2.0/umd/react-is.production.min.js',
        globalVar: 'ReactIs'
      },
      'prop-types': {
        url: 'https://unpkg.com/prop-types@15.8.1/prop-types.js',
        globalVar: 'PropTypes'
      },
      'd3': {
        url: 'https://unpkg.com/d3@7.8.5/dist/d3.min.js',
        globalVar: 'd3'
      },
      'plotly.js': {
        url: 'https://cdn.plot.ly/plotly-latest.min.js',
        globalVar: 'Plotly'
      },
      'three': {
        url: 'https://unpkg.com/three@0.158.0/build/three.min.js',
        globalVar: 'THREE'
      },
      'lucide-react': {
        url: 'https://unpkg.com/lucide@latest/dist/umd/lucide.js',
        globalVar: 'lucide'
      },
      'chart.js': {
        url: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
        globalVar: 'Chart'
      },
      'mathjs': {
        url: 'https://unpkg.com/mathjs@12.2.0/lib/browser/math.min.js',
        globalVar: 'math'
      },
    };

    // Обрабатываем импорты React - заменяем на использование window.React
    const reactImportRegex = /import\s+(?:\{([^}]+)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]react['"];?\n?/g;
    processedCode = processedCode.replace(reactImportRegex, (_match, namedImports, namespaceAlias, defaultImport) => {
      if (namedImports) {
        // import { useState, useEffect } from 'react'
        const imports = namedImports.split(',').map((s: string) => s.trim());
        return imports.map((imp: string) => {
          const parts = imp.split(' as ');
          const originalName = parts[0].trim();
          const alias = parts[1]?.trim() || originalName;

          // Отслеживаем импортированные хуки
          const hookNames = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useReducer'];
          if (hookNames.includes(originalName)) {
            importedHooks.add(originalName);
          }

          // Используем window.React для надежности в strict mode
          return `const ${alias} = window.React.${originalName}`;
        }).join(';\n') + ';\n';
      } else if (namespaceAlias) {
        // import * as ReactLib from 'react'
        // При namespace импорте считаем что все хуки доступны через namespace
        return `const ${namespaceAlias} = window.React;\n`;
      } else if (defaultImport) {
        // import React from 'react'
        return `const ${defaultImport} = window.React;\n`;
      }
      return '';
    });

    // Обрабатываем импорты других библиотек
    const importRegex = /import\s+(?:(?:\{([^}]+)\}|(\w+)|(\*)\s+as\s+(\w+)))\s+from\s+['"](.+?)['"];?\n?/g;
    let match;
    const processedImports: string[] = [];

    const ensureLib = (name: string) => {
      const lib = libMap[name];
      if (!lib) {
        return;
      }
      if (!requiredLibs.find(l => l.name === name)) {
        requiredLibs.push({ name, url: lib.url, globalVar: lib.globalVar });
      }
    };

    // ВАЖНО: используем processedCode, а не code, так как React импорты уже обработаны
    while ((match = importRegex.exec(processedCode)) !== null) {
      const namedImports = match[1];
      const defaultImport = match[2];
      const namespaceImport = match[3];
      const namespaceAlias = match[4];
      const importPath = match[5];

      // Пропускаем, если importPath не определен
      if (!importPath || typeof importPath !== 'string') {
        continue;
      }

      const libName = importPath.split('/')[0];

      // Пропускаем React (уже обработали) и относительные импорты
      if (importPath === 'react' || importPath.startsWith('.')) {
        continue;
      }

      // Если библиотека есть в маппинге
      if (libMap[libName]) {
        if (libName === 'recharts') {
          // Recharts требует react-is и prop-types
          ensureLib('react-is');
          ensureLib('prop-types');
        }
        ensureLib(libName);
        const lib = libMap[libName];

        // Обрабатываем именованные импорты
        if (namedImports) {
          const imports = namedImports.split(',').map((s: string) => s.trim());
          if (libName === 'recharts') {
            // Для recharts используем глобальные переменные напрямую
            // Они будут установлены setupRecharts() перед выполнением кода
            const destructured = imports.map((imp: string) => {
              const parts = imp.split(' as ');
              const originalName = parts[0].trim();
              const alias = parts[1]?.trim() || originalName;
              // Используем window[ComponentName] или fallback на Recharts.ComponentName
              return `const ${alias} = typeof window !== 'undefined' && window['${originalName}'] ? window['${originalName}'] : (typeof ${lib.globalVar} !== 'undefined' && ${lib.globalVar}['${originalName}'] ? ${lib.globalVar}['${originalName}'] : null)`;
            }).join(';\n');
            processedImports.push(destructured);
          } else {
            // Для других библиотек используем стандартный подход
            const destructured = imports.map((imp: string) => {
              const parts = imp.split(' as ');
              const originalName = parts[0].trim();
              const alias = parts[1]?.trim() || originalName;
              return `const ${alias} = ${lib.globalVar}.${originalName}`;
            }).join(';\n');
            processedImports.push(destructured);
          }
        } else if (namespaceImport && namespaceAlias) {
          // import * as X from 'lib'
          processedImports.push(`const ${namespaceAlias} = ${lib.globalVar}`);
        } else if (defaultImport) {
          // import X from 'lib'
          processedImports.push(`const ${defaultImport} = ${lib.globalVar}`);
        }
      }
    }

    // Удаляем все оставшиеся импорты из кода
    processedCode = processedCode.replace(/import\s+.*?\s+from\s+['"].*?['"];?\n?/g, '');

    // Обрабатываем export default - сохраняем компонент в глобальную переменную
    // Сначала обрабатываем именованные экспорты функций
    processedCode = processedCode.replace(
      /export\s+default\s+function\s+(\w+)\s*\(/g,
      'function $1('
    );

    // Затем обрабатываем const экспорты
    processedCode = processedCode.replace(
      /export\s+default\s+const\s+(\w+)\s*=/g,
      'const $1 ='
    );

    // Обрабатываем экспорт уже определенной переменной
    processedCode = processedCode.replace(
      /export\s+default\s+(\w+)\s*;?\s*$/gm,
      (_match, varName) => {
        return `const DefaultExport = ${varName};\nwindow.DefaultExport = ${varName};\nwindow.${varName} = ${varName};`;
      }
    );

    // Обрабатываем анонимные экспорты (export default { ... } или export default function() { ... })
    // Это сложнее, поэтому используем обертку
    if (/export\s+default\s+(?!function\s+\w|const\s+\w|\w+\s*;?\s*$)/.test(processedCode)) {
      // Заменяем export default на присвоение в глобальную переменную
      processedCode = processedCode.replace(
        /export\s+default\s+([^;]+);?\s*$/gm,
        'const DefaultExport = $1;\nwindow.DefaultExport = DefaultExport;'
      );
    }

    // После всех определений функций/компонентов добавляем их в window
    // Это нужно для того, чтобы Babel мог их найти
    const functionDefRegex = /(?:function|const)\s+([A-Z][a-zA-Z0-9]*)\s*[=\(]/g;
    let functionMatch;
    const definedFunctions: string[] = [];
    while ((functionMatch = functionDefRegex.exec(processedCode)) !== null) {
      const funcName = functionMatch[1];
      if (funcName && !definedFunctions.includes(funcName)) {
        definedFunctions.push(funcName);
      }
    }

    // Добавляем присвоение в window для всех найденных компонентов
    if (definedFunctions.length > 0) {
      const windowAssignments = definedFunctions.map(name =>
        `if (typeof ${name} !== 'undefined') { window.${name} = ${name}; }`
      ).join('\n');
      processedCode += '\n\n' + windowAssignments;
    }

    // Добавляем обработанные импорты в начало
    if (processedImports.length > 0) {
      processedCode = processedImports.join(';\n') + ';\n\n' + processedCode;
    }

    return { processedCode, requiredLibs, importedHooks };
  };

  useEffect(() => {
    if (!validation.valid || !iframeRef.current) {
      return;
    }

    // Проверяем, что содержимое артефакта существует
    if (!artifact.content || typeof artifact.content !== 'string') {
      console.warn('ReactArtifactRenderer: artifact.content is missing or invalid');
      return;
    }

    const iframe = iframeRef.current;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;

    if (doc) {
      try {
        // Обрабатываем импорты
        const { processedCode, requiredLibs, importedHooks } = processImports(artifact.content);

        // МЕТОДИЧНО: Вычисляем какие хуки нужно объявить ДО создания шаблона HTML
        // Преобразуем Set в массив для использования
        const importedHooksArray = Array.from(importedHooks);
        const allHooks = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useReducer'];
        const hooksToDeclare = allHooks.filter(hook => !importedHooksArray.includes(hook));

        // Создаем строку объявления хуков для вставки в шаблон
        // Используем window.* вместо var для надежности в strict mode
        let hooksDeclarationCode = '';
        if (hooksToDeclare.length > 0) {
          const hooksAssignments = hooksToDeclare.map(hook =>
            `window.${hook} = window.React.${hook};`
          ).join('\n');
          hooksDeclarationCode = `if (typeof window.React !== 'undefined') {\n  ${hooksAssignments}\n}\n`;
        }

        // Создаем JSON массив для динамической загрузки библиотек
        const libsToLoad = JSON.stringify(requiredLibs.map(lib => ({ name: lib.name, url: lib.url, globalVar: lib.globalVar })));

        // Создаем безопасный React компонент в iframe
        // Используем Babel для трансформации JSX и ES6 модулей
        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 16px; font-family: system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    // Загружаем React синхронно (блокирующая загрузка)
    window.reactLoadPromise = (async function() {
      const scripts = [
        'https://unpkg.com/react@18/umd/react.production.min.js',
        'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
        'https://unpkg.com/@babel/standalone/babel.min.js'
      ];
      
      function loadScriptSync(url) {
        return new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = url;
          script.crossOrigin = 'anonymous';
          script.async = false;
          script.defer = false;
          script.onload = () => {
            // React и ReactDOM уже доступны через window после загрузки UMD bundle
            // Не пытаемся создавать глобальные переменные - используем только window.*
            resolve();
          };
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      
      // Загружаем все скрипты последовательно
      for (const url of scripts) {
        await loadScriptSync(url);
      }
      
      // React и ReactDOM доступны через window после загрузки UMD bundle
      // Не нужно создавать глобальные переменные
    })();
  </script>
  <script>
    // Упрощенная функция для экспорта компонентов recharts в глобальную область видимости
    // Используем более предсказуемый подход - проверяем только window.Recharts
    function setupRecharts() {
      // UMD bundle Recharts обычно экспортирует в window.Recharts
      const rechartsLib = window.Recharts;
      
      if (!rechartsLib || typeof rechartsLib !== 'object') {
        console.warn('Recharts library not found in window.Recharts');
        return;
      }
      
      // Список компонентов для экспорта
      const rechartsComponents = [
        'ResponsiveContainer', 'LineChart', 'BarChart', 'PieChart', 'AreaChart',
        'XAxis', 'YAxis', 'CartesianGrid', 'Tooltip', 'Legend', 'Line', 'Bar',
        'Pie', 'Cell', 'Area', 'RadarChart', 'Radar', 'PolarGrid', 'PolarAngleAxis',
        'PolarRadiusAxis', 'ScatterChart', 'Scatter', 'ComposedChart', 'ReferenceLine',
        'ReferenceArea', 'Brush', 'ErrorBar', 'FunnelChart', 'Funnel', 'LabelList'
      ];
      
      // Экспортируем компоненты напрямую из window.Recharts
      let exportedCount = 0;
      rechartsComponents.forEach(componentName => {
        const component = rechartsLib[componentName];
        if (component && typeof component === 'function') {
          window[componentName] = component;
          exportedCount++;
        }
      });
      
      if (exportedCount === 0) {
        console.warn('No Recharts components found. Available keys:', Object.keys(rechartsLib).slice(0, 20));
      }
    }
    
    // Делаем функцию доступной глобально
    window.setupRecharts = setupRecharts;
    
    // Функция для динамической загрузки скриптов
    function loadScript(url, name) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = false;
        script.defer = false;
        script.onload = () => {
          window[name + 'Loaded'] = true;
          resolve();
        };
        script.onerror = (error) => {
          console.error('Failed to load ' + name + ' from ' + url, error);
          reject(new Error('Failed to load ' + name));
        };
        document.head.appendChild(script);
      });
    }
    
    async function waitForReact() {
      const start = Date.now();
      while (typeof window.React === 'undefined' || typeof window.ReactDOM === 'undefined') {
        if (Date.now() - start > 5000) {
          throw new Error('React libraries did not load in time');
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    // Функция для настройки react-is и prop-types после загрузки
    function setupReactIs() {
      // react-is должен быть доступен глобально для Recharts
      if (typeof window.ReactIs !== 'undefined') {
        // Делаем react-is доступным через разные пути для совместимости
        if (typeof window !== 'undefined' && !window['react-is']) {
          window['react-is'] = window.ReactIs;
        }
      }
      
      // prop-types должен быть доступен глобально
      // Проверяем разные варианты экспорта prop-types
      if (typeof window.PropTypes === 'undefined') {
        // Вариант 1: PropTypes в глобальной области видимости
        if (typeof PropTypes !== 'undefined') {
          window.PropTypes = PropTypes;
        }
        // Вариант 2: PropTypes через window.PropTypes (некоторые UMD бандлы)
        else if (typeof window !== 'undefined' && window.PropTypes) {
          // Уже установлен
        }
        // Вариант 3: Создаем минимальный stub для совместимости
        else {
          console.warn('PropTypes not found, creating minimal stub');
          window.PropTypes = {
            oneOfType: function(types) {
              return function(props, propName, componentName) {
                const value = props[propName];
                for (let i = 0; i < types.length; i++) {
                  const type = types[i];
                  if (typeof type === 'function') {
                    const error = type(props, propName, componentName);
                    if (error == null) return null;
                  }
                }
                return new Error('Invalid prop type');
              };
            },
            string: function() { return null; },
            number: function() { return null; },
            bool: function() { return null; },
            object: function() { return null; },
            array: function() { return null; },
            func: function() { return null; },
            node: function() { return null; },
            element: function() { return null; },
          };
        }
      }
      
      // Убеждаемся, что PropTypes.oneOfType существует (критично для Recharts)
      if (window.PropTypes && typeof window.PropTypes.oneOfType !== 'function') {
        window.PropTypes.oneOfType = function(types) {
          return function(props, propName, componentName) {
            const value = props[propName];
            for (let i = 0; i < types.length; i++) {
              const type = types[i];
              if (typeof type === 'function') {
                const error = type(props, propName, componentName);
                if (error == null) return null;
              }
            }
            return new Error('Invalid prop type');
          };
        };
      }
    }
    
    // Загружаем все библиотеки перед запуском Babel-кода
    async function loadAllLibraries() {
      const libs = ${libsToLoad};
      
      if (libs.length === 0) {
        return;
      }
      
      await waitForReact();
      
      // ВАЖНО: react-is и prop-types должны загружаться ПЕРЕД recharts
      const reactIsLib = libs.find(l => l.name === 'react-is');
      const propTypesLib = libs.find(l => l.name === 'prop-types');
      const rechartsLib = libs.find(l => l.name === 'recharts');
      const otherLibs = libs.filter(l => l.name !== 'react-is' && l.name !== 'prop-types' && l.name !== 'recharts');
      
      // 1. Сначала загружаем react-is, если он нужен
      if (reactIsLib) {
        try {
          await loadScript(reactIsLib.url, reactIsLib.name);
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error('Failed to load react-is', error);
        }
      }
      
      // 2. Затем загружаем prop-types, если он нужен
      if (propTypesLib) {
        try {
          await loadScript(propTypesLib.url, propTypesLib.name);
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error('Failed to load prop-types', error);
        }
      }
      
      // 3. Настраиваем react-is и prop-types после загрузки
      setupReactIs();
      
      // 4. Затем загружаем recharts (если нужен)
      if (rechartsLib) {
        try {
          await loadScript(rechartsLib.url, rechartsLib.name);
          // Даем время на инициализацию
          await new Promise(resolve => setTimeout(resolve, 200));
          setupRecharts();
          
          // Проверяем результат
          const hasComponents = window.ResponsiveContainer || window.LineChart || window.BarChart;
          if (!hasComponents) {
            await new Promise(resolve => setTimeout(resolve, 300));
            setupRecharts();
          }
        } catch (error) {
          console.error('Failed to load recharts', error);
        }
      }
      
      // 5. Затем загружаем остальные библиотеки
      for (const lib of otherLibs) {
        try {
          await loadScript(lib.url, lib.name);
        } catch (error) {
          console.error('Failed to load ' + lib.name, error);
        }
      }
    }
    
    // Флаг для отслеживания загрузки
    window.librariesReady = false;
    window.librariesLoadPromise = loadAllLibraries().then(() => {
      console.log('=== All libraries loaded, ready to render ===');
      window.librariesReady = true;
    }).catch(error => {
      console.error('Error loading libraries:', error);
      window.librariesReady = true; // Продолжаем даже при ошибке
    });
  </script>
  <script>
    // ВАЖНО: Убеждаемся, что React загружен перед выполнением кода
    (async function() {
      // Ждем загрузки React, ReactDOM и Babel
      if (window.reactLoadPromise) {
        await window.reactLoadPromise;
      }
      
      // Дополнительная проверка
      const waitForLibraries = () => {
        return new Promise((resolve) => {
          const checkLibraries = () => {
            if (typeof window.React !== 'undefined' && 
                typeof window.ReactDOM !== 'undefined' && 
                typeof window.Babel !== 'undefined') {
              // React и ReactDOM доступны через window - этого достаточно
              resolve();
            } else {
              setTimeout(checkLibraries, 50);
            }
          };
          checkLibraries();
        });
      };
      
      await waitForLibraries();
      
      // React и ReactDOM доступны через window.React и window.ReactDOM
      // Используем только window.* доступ для надежности в strict mode
      
      // Ждем загрузки всех библиотек с таймаутом
      if (window.librariesLoadPromise) {
        try {
          await Promise.race([
            window.librariesLoadPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Libraries load timeout')), 10000))
          ]);
        } catch (error) {
          console.warn('Libraries loading timeout or error:', error);
          // Продолжаем выполнение даже если библиотеки не загрузились
        }
      }
      
      try {
        // Трансформируем код пользователя через Babel
        // Используем JSON.stringify для безопасного экранирования
        const userCode = ${JSON.stringify(processedCode)};
        
        // Babel будет использовать React.createElement из window.React
        // Убеждаемся что window.React доступен (должен быть после загрузки)
        if (typeof window.React === 'undefined') {
          throw new Error('React is not loaded. window.React is undefined.');
        }
        
        // Настраиваем Babel для использования window.React
        // Используем pragma чтобы Babel генерировал window.React.createElement вместо React.createElement
        const transformedCode = Babel.transform(userCode, {
          presets: [
            ['react', { 
              runtime: 'classic',
              pragma: 'window.React.createElement', // Указываем использовать window.React
              pragmaFrag: 'window.React.Fragment'
            }],
            'env'
          ],
          plugins: []
        }).code;
        
        // Заменяем возможные прямые обращения к React на window.React
        // (на случай если Babel все еще генерирует React.createElement)
        let codeWithReact = transformedCode.replace(/React\.createElement/g, 'window.React.createElement');
        codeWithReact = codeWithReact.replace(/React\.Fragment/g, 'window.React.Fragment');
        
        // Заменяем React.useState и другие хуки на window.React.*
        codeWithReact = codeWithReact.replace(/React\.(useState|useEffect|useRef|useMemo|useCallback|useReducer)/g, 'window.React.$1');
        
        // Добавляем в начало объявления для удобства
        // hooksDeclarationCode уже вычислен выше в TypeScript коде
        // Используем только window.* доступ
        codeWithReact = \`
          // React и ReactDOM доступны через window
          // Хуки также доступны через window.*
          ${hooksDeclarationCode}
          
          \${codeWithReact}
        \`;
        
        // Выполняем код
        eval(codeWithReact);
        
        // Ищем экспортированный компонент
        let ComponentToRender = null;
        const debugInfo = [];
        
        // Проверяем различные варианты экспорта
        if (typeof Component !== 'undefined') {
          ComponentToRender = Component;
          debugInfo.push('Найден Component');
        } else if (typeof App !== 'undefined') {
          ComponentToRender = App;
          debugInfo.push('Найден App');
        } else if (typeof DefaultExport !== 'undefined') {
          ComponentToRender = DefaultExport;
          debugInfo.push('Найден DefaultExport');
        } else {
          // Пытаемся найти все определенные компоненты (функции с заглавной буквы)
          const allVars = Object.keys(window);
          const components = allVars
            .filter(key => {
              try {
                return typeof window[key] === 'function' && 
                       key[0] === key[0].toUpperCase() && 
                       key !== 'React' && 
                       key !== 'ReactDOM' &&
                       !key.startsWith('Babel');
              } catch (e) {
                return false;
              }
            })
            .map(key => ({ name: key, component: window[key] }));
          
          debugInfo.push('Найдено компонентов: ' + components.length);
          debugInfo.push('Имена: ' + components.map(c => c.name).join(', '));
          
          if (components.length > 0) {
            // Берем последний компонент
            ComponentToRender = components[components.length - 1].component;
            debugInfo.push('Используется компонент: ' + components[components.length - 1].name);
          }
        }
        
        if (ComponentToRender && typeof ComponentToRender === 'function') {
          try {
            const root = window.ReactDOM.createRoot(document.getElementById('root'));
            root.render(window.React.createElement(ComponentToRender));
            console.log('React компонент успешно отрендерен', debugInfo);
          } catch (renderError) {
            console.error('Ошибка при рендеринге компонента:', renderError);
            document.getElementById('root').innerHTML = '<div style="color: #dc2626; padding: 16px; background: #fee2e2; border-radius: 8px;"><strong>Ошибка рендеринга:</strong><br>' + renderError.message + '<br><br><pre style="font-size: 12px; overflow: auto; max-height: 200px;">' + (renderError.stack || '') + '</pre><br><small>Debug: ' + debugInfo.join(', ') + '</small></div>';
          }
        } else {
          console.warn('Компонент не найден', debugInfo);
          const allVars = Object.keys(window).filter(k => typeof window[k] === 'function').slice(0, 20);
          document.getElementById('root').innerHTML = '<div style="color: #dc2626; padding: 16px; background: #fee2e2; border-radius: 8px;"><strong>Ошибка:</strong> React компонент не найден.<br><br>Убедитесь что код экспортирует компонент через:<br>- export default function ComponentName()<br>- export default ComponentName<br>- const ComponentName = ...; export default ComponentName<br><br><small>Debug: ' + debugInfo.join(', ') + '</small><br><small>Доступные функции: ' + allVars.join(', ') + '</small></div>';
        }
      } catch (error) {
        console.error('React render error:', error);
        document.getElementById('root').innerHTML = '<div style="color: #dc2626; padding: 16px; background: #fee2e2; border-radius: 8px;"><strong>Ошибка выполнения кода:</strong><br>' + error.message + '<br><br><pre style="font-size: 12px; overflow: auto; max-height: 200px;">' + (error.stack || '') + '</pre></div>';
      }
    })();
  </script>
</body>
</html>`;

        doc.open();
        doc.write(htmlContent);
        doc.close();
        setIsRendered(true);

        // Функция для обновления высоты iframe на основе содержимого
        const updateHeight = () => {
          try {
            const body = doc.body;
            const html = doc.documentElement;

            if (body && html) {
              // Получаем максимальную высоту из body и html
              const height = Math.max(
                body.scrollHeight,
                body.offsetHeight,
                html.clientHeight,
                html.scrollHeight,
                html.offsetHeight
              );

              // Устанавливаем минимальную высоту 400px и добавляем небольшой отступ
              setIframeHeight(Math.max(400, height + 20));
            }
          } catch (e) {
            // Если не удалось получить высоту, используем значение по умолчанию
            console.warn('Failed to calculate iframe height:', e);
          }
        };

        // Обновляем высоту после загрузки содержимого
        if (doc.readyState === 'complete') {
          updateHeight();
        } else {
          // Ждем загрузки всех ресурсов (изображений, скриптов и т.д.)
          const checkLoad = setInterval(() => {
            if (doc.readyState === 'complete') {
              updateHeight();
              clearInterval(checkLoad);
            }
          }, 100);

          // Таймаут на случай, если загрузка затянется
          setTimeout(() => {
            clearInterval(checkLoad);
            updateHeight();
          }, 3000);
        }

        // Также обновляем высоту при изменении размера окна
        const handleResize = () => {
          updateHeight();
        };

        if (iframe.contentWindow) {
          iframe.contentWindow.addEventListener('resize', handleResize);
        }

        // Используем MutationObserver для отслеживания изменений в DOM
        const observer = new MutationObserver(() => {
          updateHeight();
        });

        if (doc.body) {
          observer.observe(doc.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
          });
        }

        return () => {
          observer.disconnect();
          if (iframe.contentWindow) {
            iframe.contentWindow.removeEventListener('resize', handleResize);
          }
        };
      } catch (error) {
        console.error('ReactArtifactRenderer: Error rendering artifact', error);
        setIsRendered(false);
      }
    }
  }, [artifact.content, validation.valid]);

  if (!validation.valid) {
    return (
      <div className="artifact-renderer artifact-react border border-red-200 rounded-lg p-4 bg-red-50">
        <div className="flex items-start gap-2 mb-2">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-red-800 mb-1">
              React artifact содержит небезопасный код
            </div>
            <div className="text-xs text-red-700 mb-2">
              {artifact.filename} ({artifact.size} bytes)
            </div>
            <div className="text-sm text-red-700">
              <strong>Ошибки:</strong>
              <ul className="list-disc list-inside mt-1">
                {validation.errors.map((error: any, i: any) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
              {validation.warnings.length > 0 && (
                <>
                  <strong className="mt-2 block">Предупреждения:</strong>
                  <ul className="list-disc list-inside">
                    {validation.warnings.map((warning: any, i: any) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="artifact-renderer artifact-react border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="mb-2 text-xs text-gray-500 font-mono px-4 pt-2">
        {artifact.filename} ({artifact.size} bytes)
        {validation.warnings.length > 0 && (
          <span className="ml-2 text-yellow-600">
            ⚠ {validation.warnings.length} предупреждений
          </span>
        )}
      </div>
      <iframe
        ref={iframeRef}
        className="w-full border-0"
        style={{
          minHeight: '400px',
          height: `${iframeHeight}px`,
          display: 'block'
        }}
        title={artifact.filename}
        sandbox="allow-scripts allow-same-origin"
      />
      {!isRendered && (
        <div className="p-4 text-center text-gray-500">
          Загрузка React компонента...
        </div>
      )}
    </div>
  );
};

