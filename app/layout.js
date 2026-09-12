export const metadata = {
  title: "Vantage Point — Online Escape Room",
  description:
    "A first-person escape room you play entirely in the browser — nowhere you actually are, but it feels like you're standing right in it.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: "#000" }}>
        {children}
      </body>
    </html>
  );
}
