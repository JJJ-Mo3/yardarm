/* Yardarm website: mobile nav toggle, copy-to-clipboard, docs TOC highlight. */

document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.querySelector('.nav-toggle')
  var links = document.querySelector('.nav-links')
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open')
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
    })
  }

  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy') || ''
      navigator.clipboard.writeText(text).then(function () {
        var original = btn.textContent
        btn.textContent = 'Copied!'
        setTimeout(function () {
          btn.textContent = original
        }, 1600)
      })
    })
  })

  var tocLinks = document.querySelectorAll('.docs-sidebar .toc a[href^="#"]')
  if (tocLinks.length > 0 && 'IntersectionObserver' in window) {
    var map = {}
    tocLinks.forEach(function (link) {
      map[link.getAttribute('href').slice(1)] = link
    })
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && map[entry.target.id]) {
            tocLinks.forEach(function (l) {
              l.classList.remove('active')
            })
            map[entry.target.id].classList.add('active')
          }
        })
      },
      { rootMargin: '-20% 0px -70% 0px' }
    )
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id)
      if (el) observer.observe(el)
    })
  }
})
