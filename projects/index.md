---
title: Projects
nav:
  order: 2
  tooltip: Software, datasets, and more
---

# {% include icon.html icon="fa-solid fa-wrench" %}Projects

We publish in a variety of areas that cross-feed each other, including: 
3D Computer Vision including 3D/4D Generative Priors, Geometric & Topological Deep Learning, Statistical & Topological Learning Theory, Mechanistic Interpretability, Quantum Computer Vision and Generative Models for Biochemistry.

<!--{% include tags.html tags="publication, resource, website" %}-->

{% include search-info.html %}

{% include section.html %}

## Featured

{% include list.html component="card" data="projects" filter="group == 'featured'" %}

{% include section.html %}

## More

{% include list.html component="card" data="projects" filter="!group" style="small" %}
