
export async function subscribe() {
  if ('serviceWorker' in navigator) {
    let sw = await navigator.serviceWorker.ready;
    let push = await sw.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: 'BDNhhvCejJLGp8C1DSl0rzwdmONmv7EsfJTk0TG0flkvmvacsY9IkufqR63Ykfs8o-goFKEYxra7vUwxBURj8rs'
    });

    const data = {
      sub: push,
      user: 'bcsotty' // Replace with user's username once system is built
    };

    fetch('http://localhost:4000/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    }).then(response => {
      if (response.ok)
        alert('Successfully subscribed to fire alarm alerts!' + response.ok);
      else
      alert('Subscribe failure: ' + response.ok)
    });
  }

}

// Allows offline support for PWA
if ('serviceWorker' in navigator) {
  addEventListener('load', async () => {
    await navigator.serviceWorker.register('/sw.js');
    console.log('Service Worker Registered');
  });
} else {
  // Disable the subscribe to notifications feature
}
