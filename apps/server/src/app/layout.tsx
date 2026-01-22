export const metadata = {
  title: 'HAP Demo - Deploy Gate',
  description: 'Human Agency Protocol Demo Server',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
