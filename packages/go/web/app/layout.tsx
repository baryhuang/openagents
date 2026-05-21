import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/lib/auth-context';
import { OpenAgentsAuthProvider } from '@/lib/openagents-auth-context';
import '@/styles/globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'OpenAgents Workspace',
  description: 'Interact with your AI agents in real time',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="amplitude-sdk" strategy="beforeInteractive">{`
          !function(){"use strict";!function(e,t){var r=e.amplitude||{_q:[],_iq:{}};if(r.invoked)e.amplitude=r;else{var n=function(e,t){e.prototype[t]=function(){return this._q.push({name:t,args:Array.prototype.slice.call(arguments,0)}),this}},s=function(e,t,r){return function(n){e._q.push({name:t,args:Array.prototype.slice.call(arguments,0),resolve:function(e){if(r){var t={};t[r]=e,e=t}return e}})}},o=function(e,t,r){e[t]=function(){if(r)return{promise:new Promise(function(n){e._q.push({name:t,args:Array.prototype.slice.call(arguments,0),resolve:n})})};e._q.push({name:t,args:Array.prototype.slice.call(arguments,0)})}},i=function(e,t){e._q.push({name:"init",args:t})};r.invoked=!0;var a=t.createElement("script");a.type="text/javascript",a.integrity="sha384-PPfHw98myKtJkA9OdPBMQ6n8yvUaYk0EyUQccFSIQGmB1gBmIDq2Oc0o42C95swE",a.crossOrigin="anonymous",a.async=!0,a.src="https://cdn.amplitude.com/libs/analytics-browser-2.11.1-min.js.gz",a.onload=function(){e.amplitude.runQueuedFunctions||console.log("[Amplitude] Error: could not load SDK")};var c=t.getElementsByTagName("script")[0];function u(e){var t=this;t._q=[],Object.defineProperty(t,"_q",{enumerable:!1}),t.name=e,o(t,"init"),o(t,"remove"),o(t,"track"),o(t,"logEvent"),o(t,"identify"),o(t,"groupIdentify"),o(t,"setGroup"),o(t,"getSessionId",!0),o(t,"setSessionId"),o(t,"getUserId"),o(t,"setUserId"),o(t,"getDeviceId"),o(t,"setDeviceId"),o(t,"setOptOut"),o(t,"setTransport"),o(t,"reset"),o(t,"extendSession")}c.parentNode.insertBefore(a,c),r.createInstance=function(e){return r._iq[e]={_q:[]},r._iq[e]},e.amplitude=r;var p=r.createInstance("$default_instance");i(p,["31968c466196be31098d0a126fabc82a",{autocapture:{elementInteractions:!0}}]),p.add({name:"google-tag-forwarder",type:"enrichment",setup:async function(e,t){},execute:async function(e,t){var r=e.event_type;if("string"==typeof r&&e.event_properties&&window.gtag){var n=Object.assign({},e.event_properties);window.gtag("event",r,n)}return e}})}}(window,document);
          amplitude.init('31968c466196be31098d0a126fabc82a');
        `}</Script>
        <Script src="https://www.googletagmanager.com/gtag/js?id=G-LLGDK0V3WP" strategy="afterInteractive" />
        <Script id="gtag-init" strategy="afterInteractive">{`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-LLGDK0V3WP');
        `}</Script>
      </head>
      <body className={`${inter.className} bg-zinc-100 dark:bg-zinc-900`}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <AuthProvider>
            <OpenAgentsAuthProvider>
              {children}
            </OpenAgentsAuthProvider>
          </AuthProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
