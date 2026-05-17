document.addEventListener("DOMContentLoaded", () => {
    // Intercept clicks to guide.html
    const guideLinks = document.querySelectorAll('a[href="guide.html"]');
    guideLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            if (document.documentElement.getAttribute('data-theme') === 'rayon') {
                e.preventDefault();
                // Play animation
                document.body.classList.add('is-transitioning-to-guide');
                
                // Wait for animation to finish then navigate
                setTimeout(() => {
                    window.location.href = link.href;
                }, 1500);
            }
        });
    });
});
