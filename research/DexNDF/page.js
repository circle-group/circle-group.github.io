document.querySelectorAll(".more-videos").forEach(group => {
  group.addEventListener("toggle", () => {
    if (!group.open) group.querySelectorAll("video").forEach(video => video.pause());
  });
});
